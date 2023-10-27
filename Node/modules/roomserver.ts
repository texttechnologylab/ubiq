import { Message, NetworkId, TcpConnectionWrapper, Uuid, WebSocketConnectionWrapper, WrappedSecureWebSocketServer, WrappedTcpServer } from "ubiq";
import { EventEmitter } from 'events';
import { ValidationError } from "jsonschema";
import { string, z } from 'zod';
import fs from 'fs';

const VERSION_STRING = "0.0.4";
const RoomServerReservedId = 1;

// The following Zod objects define the schema for the RoomSever messages on
// the wire.

const RoomServerMessage = z.object({
    type: z.string(),
    args: z.string()
});


const RoomInfo = z.object({
    uuid: z.string(),
    joincode: z.string(),
    publish: z.boolean(),
    name: z.string(),
    keys: z.array(z.string()),
    values: z.array(z.string())
})

const PeerInfo = z.object({
    uuid: z.string(),
    sceneid: NetworkId.Schema,
    clientid: NetworkId.Schema,
    keys: z.array(z.string()),
    values: z.array(z.string())
});


const JoinArgs = z.object({
    joincode: z.string().optional(),
    uuid: z.string().optional(),
    name: z.string().optional(),
    publish: z.boolean(),
    peer: PeerInfo
});


const PingArgs = z.object({
    clientid: NetworkId.Schema
});

const AppendPeerPropertiesArgs = z.object({
    keys: z.array(z.string()),
    values: z.array(z.string())
});


const AppendRoomPropertiesArgs = z.object({
    keys: z.array(z.string()),
    values: z.array(z.string())
});


const DiscoverRoomArgs = z.object({
    clientid: NetworkId.Schema,
    joincode: z.string()
});

const SetBlobArgs = z.object({
    uuid: z.string(),
    blob: z.string()
});

const GetBlobArgs = z.object({
    clientid: NetworkId.Schema,
    uuid: z.string()
});

// A number of these message types are exported, as they are also used by Js
// RoomClient implementations.

export type RoomInfo = z.infer<typeof RoomInfo>
export type RoomServerMessage = z.infer<typeof RoomServerMessage>
export type PeerInfo = z.infer<typeof PeerInfo>
export type JoinArgs = z.infer<typeof JoinArgs>;
export type AppendPeerPropertiesArgs = z.infer<typeof AppendPeerPropertiesArgs>;
export type AppendRoomPropertiesArgs = z.infer<typeof AppendRoomPropertiesArgs>;

// Next we define a set of convenience functions and classes

// https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
// Proof of concept - not crypto secure
function JoinCode() {
    var result           = '';
    var characters       = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < 3; i++ ) {
       result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function arrayRemove<T extends any>(array: T[], element: T){
    const index = array.indexOf(element);
    if (index > -1) {
        array.splice(index, 1);
    }
}

interface DictionaryResponse {
    keys: string[]
    values: any[]
}

class PropertyDictionary{
    dict: Record<string, any>;
    constructor(){
        this.dict = {};
    }

    append(keys: string | string[],values? : any | any[]){
        var response : DictionaryResponse = {
            keys: [],
            values: []
        };

        if (keys === undefined || values === undefined){
            return response;
        }

        const set = function(key: string, value: any, dict: Record<string, any>) {
            if (value === ""){
                // Attempting to remove
                if (dict.hasOwnProperty(key)){
                    delete dict[key];
                    return true;
                }

                return false;
            }

            if (dict.hasOwnProperty(key) && dict[key] === value){
                return false;
            }

            dict[key] = value;
            return true;
        }

        if ((typeof keys === 'string'/* || keys instanceof String*/)
            && (typeof values === 'string' /*|| values instanceof String*/)) {

            if (set(keys,values,this.dict)){
                response.keys = [keys],
                response.values = [values]
            }
            return response;
        }

        if (!Array.isArray(keys) || !Array.isArray(values)){
            return response;
        }

        // Set for uniqueness - if modified multiple times, last value is used
        var modified = new Set<string>();
        var dict = this.dict;
        keys.forEach(function(key,i){
            if (values.length <= i){
                return;
            }

            var value = values[i];
            if (set(key,value,dict)){
                modified.add(key);
            }
        });

        response.keys = Array.from(modified);
        response.values = response.keys.map((key) => this.get(key));
        return response;
    }

    set(keys: string | string[], values: any | any[]){
        this.dict = {};
        this.append(keys,values);
    }

    get(key: string){
        if (this.dict.hasOwnProperty(key)){
            return this.dict[key];
        }
        return "";
    }

    keys(){
        return Object.keys(this.dict);
    }

    values(){
        return Object.values(this.dict);
    }
}

class RoomDatabase{
    byUuid: {
        [uuid: string] : Room
    };
    byJoincode: {
        [joincode: string] : Room
    };
    constructor(){
        this.byUuid = {};
        this.byJoincode = {};
    }

    // Return all room objects in the database
    all(){
        //FIXME: Why not Object.values?
        return Object.keys(this.byUuid).map(k => this.byUuid[k]);
    }

    // Add room to the database
    add(room : Room){
        this.byUuid[room.uuid] = room;
        this.byJoincode[room.joincode] = room;
    }

    // Remove room from the database by uuid
    remove(uuid: string){
        delete this.byJoincode[this.byUuid[uuid].joincode];
        delete this.byUuid[uuid];
    }

    // Return room object with given uuid, or null if not present
    uuid(uuid: string) {
        if (this.byUuid.hasOwnProperty(uuid)) {
            return this.byUuid[uuid];
        }
        return null;
    }

    // Return room object with given joincode, or null if not present
    joincode(joincode: string) {
        if (this.byJoincode.hasOwnProperty(joincode)) {
            return this.byJoincode[joincode];
        }
        return null;
    }
}

// This is the primary server for rendezvous and bootstrapping. It accepts 
// websocket and net connections, (immediately handing them over to RoomPeer
// instances) and performs book-keeping for finding and joining rooms.

export class RoomServer extends EventEmitter{
    roomDatabase: RoomDatabase;
    version: string;
    networkId: NetworkId;
    status: { connections: number; rooms: number; messages: number; bytesIn: number; bytesOut: number; time: number; };
    statusStream?: fs.WriteStream;
    statusStreamTime: number;
    intervals: NodeJS.Timeout[];
    T: typeof Room;
    constructor(){
        super();
        this.roomDatabase = new RoomDatabase();
        this.version = VERSION_STRING;
        this.networkId = new NetworkId(RoomServerReservedId);
        this.status = {
            connections: 0,
            rooms: 0,
            messages: 0,
            bytesIn: 0,
            bytesOut: 0,
            time: 0,
        }
        this.statusStream = undefined;
        this.statusStreamTime = 0;
        this.intervals = [];
        this.T = Room;
    }

    addStatusStream(filename: string){
        if(filename != undefined){
            this.statusStream = fs.createWriteStream(filename);
            this.intervals.push(setInterval(this.statusPoll.bind(this), 100));
        }
    }

    updateStatus(){
        this.status.rooms = Object.keys(this.roomDatabase.byUuid).length;
        this.status.time = (Date.now() * 10000) + 621355968000000000; // This snippet converts Js ticks to .NET ticks making them directly comparable with Ubiq's logging timestamps
        var structuredLog = JSON.stringify(this.status, (key,value)=>
            typeof value === "bigint" ? value.toString() : value
        );
        this.statusStream?.write(structuredLog + "\n");
    }

    // Called by onMessage to see if we need to update the status log.
    // The status should be updated every 100 ms or so.
    statusPoll(){
        if(this.statusStream != undefined){
            var time = Date.now();
            var interval = time - this.statusStreamTime;
            if(interval > 100){
                this.statusStreamTime = time;
                this.updateStatus();
            }
        }
    }

    addServer(server: WrappedTcpServer | WrappedSecureWebSocketServer){
        if(server.status == "LISTENING"){
            console.log("Added RoomServer port " + server.port);
            server.onConnection.push(this.onConnection.bind(this));
        }
    }

    onConnection(wrapped : TcpConnectionWrapper /*| WebSocketConnectionWrapper*/){
        console.log("RoomServer: Client Connection from " + wrapped.endpoint().address + ":" + wrapped.endpoint().port);
        new RoomPeer(this, wrapped);
    }

    // Expects args from schema ubiq.rooms.joinargs
    async join(peer : RoomPeer, args: JoinArgs){

        var room = null;
        if(args.uuid && args.uuid != ""){
            // Room join request by uuid
            if (!Uuid.validate(args.uuid)){
                console.log(peer.uuid + " attempted to join room with uuid " + args.uuid + " but the we were expecting an RFC4122 v4 uuid.");
                peer.sendRejected(args,"Could not join room with uuid " + args.uuid + ". We require an RFC4122 v4 uuid.");
                return;
            }

            // Not a problem if no such room exists - we'll create one
            room = this.roomDatabase.uuid(args.uuid);
        }
        else if(args.joincode && args.joincode != ""){
            // Room join request by joincode
            room = this.roomDatabase.joincode(args.joincode);

            if (room === null) {
                console.log(peer.uuid + " attempted to join room with code " + args.joincode + " but no such room exists");
                peer.sendRejected(args,"Could not join room with code " + args.joincode + ". No such room exists.");
                return;
            }
        }

        if (room !== null && peer.room.uuid === room.uuid){
            console.log(peer.uuid + " attempted to join room with code " + args.joincode + " but peer is already in room");
            return;
        }

        if (room === null) {
            // Otherwise new room requested
            var uuid = "";
            if(args.uuid && args.uuid != ""){
                // Use specified uuid
                // we're sure it's correctly formatted and isn't already in db
                uuid = args.uuid;
            } else {
                // Create new uuid if none specified
                while(true){
                    uuid = Uuid.generate();
                    if(this.roomDatabase.uuid(uuid) === null){
                        break;
                    }
                }
            }
            var joincode = "";
            while(true){
                joincode = JoinCode();
                if (this.roomDatabase.joincode(joincode) === null){
                    break;
                }
            }
            var publish = false;
            if (args.publish) {
                publish = args.publish;
            }
            var name = uuid;
            if (args.name && args.name.length != 0) {
                name = args.name;
            }
            room = new this.T(this);
            room.uuid = uuid;
            room.joincode = joincode;
            room.publish = publish;
            room.name = name;
            this.roomDatabase.add(room);
            this.emit("create",room);

            console.log(room.uuid + " created with joincode " + joincode);
        }

        if (peer.room.uuid != null){
            peer.room.removePeer(peer);
        }
        room.addPeer(peer);
    }

    findOrCreateRoom(args: any){
        var room = this.roomDatabase.uuid(args.uuid);
        if (room === null) {
            var joincode = "";
            while(true){
                joincode = JoinCode();
                if (this.roomDatabase.joincode(joincode) === null){
                    break;
                }
            }
            var publish = false;
            var name = args.uuid;
            var uuid = args.uuid;
            room = new this.T(this);
            room.uuid = uuid;
            room.joincode = joincode;
            room.publish = publish;
            room.name = name;
            this.roomDatabase.add(room);
            this.emit("create",room);

            console.log(room.uuid + " created with joincode " + joincode);
        }
        return room;
    }

    getRooms(){
        return this.roomDatabase.all();
    }

    // Return requested rooms for publishable rooms
    // Optionally uses joincode to filter, in which case room need not be publishable
    // Expects args from schema ubiq.rooms.discoverroomargs
    discoverRooms(args : {joincode?: string}){
        if(args.joincode && args.joincode != "") {
            return this.roomDatabase.all().filter(r => r.joincode === args.joincode);
        } else {
            return this.roomDatabase.all().filter(r => r.publish === true);
        }
    }

    removeRoom(room : Room){
        this.emit("destroy",room);
        this.roomDatabase.remove(room.uuid);
        console.log("RoomServer: Deleting empty room " + room.uuid);
    }

    exit(callback: () => void){
        for(var id of this.intervals){
            clearInterval(id);
        }
        if(this.statusStream != undefined){
            console.log("Closing status stream...");
            this.statusStream.on("finish", callback);
            this.statusStream.end();
        }
        else
        {
            callback();
        }
    }
}

// The RoomPeer class manages a Connection to a RoomClient. This class interacts
// with the connection, formatting and parsing messages and calling the 
// appropriate methods on RoomServer and others.

class RoomPeer{
    server: RoomServer;
    connection: any;
    room: Room;
    peers: {};
    networkSceneId: NetworkId;
    roomClientId: NetworkId;
    uuid: string;
    properties: PropertyDictionary;
    sessionId: string;
    observed: Room[];
    constructor(server : RoomServer, connection: any){
        this.server = server;
        this.server.status.connections += 1;
        this.connection = connection;
        this.room = new EmptyRoom();
        this.peers = {};
        this.networkSceneId = new NetworkId({
            a: Math.floor(Math.random() * 2147483648),
            b: Math.floor(Math.random() * 2147483648)
        });
        this.roomClientId = new NetworkId(0);
        this.uuid = "";
        this.properties = new PropertyDictionary();
        this.connection.onMessage.push(this.onMessage.bind(this));
        this.connection.onClose.push(this.onClose.bind(this));
        this.sessionId = Uuid.generate();
        this.observed = [];
    }

    onMessage(message: Message){
        this.server.status.messages += 1;
        this.server.status.bytesIn += message.length;
        this.server.statusPoll();
        if(NetworkId.Compare(message.networkId, this.server.networkId)){
            try{
                let object = RoomServerMessage.parse(message.toObject());
                switch(object.type){
                    case "Join":
                        {
                            let args = JoinArgs.parse(JSON.parse(object.args));
                            this.networkSceneId = args.peer.sceneid; // Join message always includes peer uuid and object id
                            this.roomClientId = args.peer.clientid;
                            this.uuid = args.peer.uuid;
                            this.properties.append(args.peer.keys, args.peer.values);
                            this.server.join(this, args);
                        }
                        break;
                    case "AppendPeerProperties":
                        {
                            let args = AppendPeerPropertiesArgs.parse(JSON.parse(object.args));
                            this.appendProperties(args.keys, args.values);
                        }
                        break;
                    case "AppendRoomProperties":
                        {
                            let args = AppendRoomPropertiesArgs.parse(JSON.parse(object.args));
                            this.room.appendProperties(args.keys,args.values);
                        }
                        break;
                    case "DiscoverRooms":
                        {
                            let args = DiscoverRoomArgs.parse(JSON.parse(object.args));
                            this.roomClientId = args.clientid; // Needs a response: send network id in case not yet set
                            this.sendDiscoveredRooms({
                                rooms: this.server.discoverRooms(args).map(r => r.getRoomArgs()),
                                version: this.server.version,
                                request: args
                            });
                        }
                        break;
                    case "SetBlob":
                        {
                            let args = SetBlobArgs.parse(JSON.parse(object.args));
                            //FIXME: room has setBlob method, but server doesn't
                            //this.server.setBlob(message.args.uuid,message.args.blob);
                            this.room.setBlob(args.uuid,args.blob)
                        }
                        break;
                    case "GetBlob":
                        {
                            let args = GetBlobArgs.parse(JSON.parse(object.args));
                            this.roomClientId = args.clientid; // Needs a response: send network id in case not yet set
                            this.sendBlob(args.uuid, this.room.getBlob(args.uuid));
                        }
                        break;
                    case "Ping":
                        {
                            let args = PingArgs.parse(JSON.parse(object.args));
                            this.roomClientId = args.clientid; // Needs a response: send network id in case not yet set
                            this.sendPing();
                        }
                        break;
                    default:
                        //FIXME: this.room.processRoomMessage(this, message);
                        this.room.processMessage(this, message);
                };
            }catch(e){
                if(e instanceof z.ZodError){
                    console.log(`Peer ${this.uuid}: Error in message - ${JSON.stringify(e.issues)}`);
                }else{
                    console.log(`Peer ${this.uuid}: Uknown error in server message`);
                }
                return;
            }
        }else{
            this.room.processMessage(this, message);
        }
    }

    onValidationFailure(error: { validation: { errors: ValidationError[] }, json : any}){
        error.validation.errors.forEach(error => {
            console.error("Validation error in " + error.schema + "; " + error.message);
        });
        console.error("Message Json: " +  JSON.stringify(error.json));
    }

    getPeerArgs(){
        return {
            uuid: this.uuid,
            sceneid: this.networkSceneId,
            clientid: this.roomClientId,
            keys: this.properties.keys(),
            values: this.properties.values()
        }
    }

    onClose(){
        this.room.removePeer(this);
        //FIXME: we never define a removeObserver method anywhere
        //this.observed.forEach(room => room.removeObserver(this));
        this.observed.forEach(room => room.removePeer(this))
        this.server.status.connections -= 1;
    }

    setRoom(room : Room){
        this.room = room;
        this.sendSetRoom();
    }

    clearRoom(){
        this.setRoom(new EmptyRoom());
    }

    getNetworkId(){
        return this.roomClientId;
    }

    appendProperties(keys: string | string[],values: any | any[]){
        var modified = this.properties.append(keys,values);
        if (modified.keys.length > 0){
            this.room.broadcastPeerProperties(this,modified.keys,modified.values);
        }
    }

    sendRejected(joinArgs: JoinArgs,reason: string){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "Rejected",
            args: JSON.stringify({
                reason: reason,
                joinArgs: joinArgs
            })
        }));
    }

    sendSetRoom(){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "SetRoom",
            args: JSON.stringify({
                room: this.room.getRoomArgs(),
            })
        }));
    }

    sendDiscoveredRooms(args: any){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "Rooms",
            args: JSON.stringify(args)
        }));
    }

    sendPeerAdded(peer: RoomPeer){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "PeerAdded",
            args: JSON.stringify({
                peer: peer.getPeerArgs()
            })
        }));
    }

    sendPeerRemoved(peer: RoomPeer){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "PeerRemoved",
            args: JSON.stringify({
                uuid: peer.uuid
            })
        }));
    }

    sendRoomPropertiesAppended(keys: string[],values: any[]){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "RoomPropertiesAppended",
            args: JSON.stringify({
                keys: keys,
                values: values
            })
        }));
    }

    sendPeerPropertiesAppended(peer: RoomPeer,keys: string[],values : any[]){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "PeerPropertiesAppended",
            args: JSON.stringify({
                uuid: peer.uuid,
                keys: keys,
                values: values
            })
        }));
    }

    sendBlob(uuid: string,blob: string){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "Blob",
            args: JSON.stringify({
                uuid: uuid,
                blob: blob
            })
        }));
    }

    sendPing(){
        this.send(Message.Create(this.getNetworkId(),
        {
            type: "Ping",
            args: JSON.stringify({
                sessionId: this.sessionId
            })
        }));
    }

    send(message: any){
        this.server.status.bytesOut += message.length;
        this.connection.send(message);
    }
}

export class Room{
    server: any;
    uuid: string;
    name: string;
    publish: boolean;
    joincode: string;
    peers: RoomPeer[];
    properties: PropertyDictionary;
    blobs: Record<string, string>;
    observers: RoomPeer[];
    constructor(server: any){
        this.server = server;
        this.uuid = "";
        this.name = "(Unnamed Room)";
        this.publish = false;
        this.joincode = "";
        this.peers = [];
        this.properties = new PropertyDictionary();
        this.blobs = {};
        this.observers = [];
    }

    broadcastPeerProperties(peer: RoomPeer,keys: string[],values: any[]){
        this.peers.forEach(otherpeer => {
            if (otherpeer !== peer){
                otherpeer.sendPeerPropertiesAppended(peer,keys,values);
            }
        });
        this.observers.forEach(otherpeer =>{
            if (otherpeer !== peer){
                otherpeer.sendPeerPropertiesAppended(peer,keys,values);
            }
        });
    }

    appendProperties(keys: string | string[],values: any){
        var modified = this.properties.append(keys,values);
        this.peers.forEach(peer => {
            peer.sendRoomPropertiesAppended(modified.keys,modified.values);
        });
    }

    addPeer(peer: RoomPeer){
        this.peers.push(peer);
        peer.setRoom(this);
        for(var existing of this.peers){ // Tell the Peers about eachother
            if(existing !== peer){
                existing.sendPeerAdded(peer); // Tell the existing peer that the new Peer has joined
                peer.sendPeerAdded(existing); // And the new Peer about the existing one
            }
        };
        console.log(peer.uuid + " joined room " + this.name);
    }

    removePeer(peer: RoomPeer){
        arrayRemove(this.peers, peer);
        peer.setRoom(new EmptyRoom()); // signal that the leave is complete
        for(var existing of this.peers){
            existing.sendPeerRemoved(peer); // Tell the remaining peers about the missing peer (no check here because the peer was already removed from the list)
            peer.sendPeerRemoved(existing);
        }
        console.log(peer.uuid + " left room " + this.name);
        this.checkRoom();
    }

    // Every time a peer or observer leaves, check if the room should still exist
    checkRoom(){
        if(this.peers.length <= 0){
            this.server.removeRoom(this);
        }
    }

    setBlob(uuid : string,blob : string){
        this.blobs[uuid] = blob;
    }

    getBlob(uuid : string){
        if(this.blobs.hasOwnProperty(uuid)){
            return this.blobs[uuid];
        }
        return "";
    }

    getRoomArgs(){
        return {
            uuid: this.uuid,
            joincode: this.joincode,
            publish: this.publish,
            name: this.name,
            keys: this.properties.keys(),
            values: this.properties.values()
        };
    }

    getPeersArgs(){
        return this.peers.map(c => c.getPeerArgs());
    }

    processMessage(source : RoomPeer, message: any){
        this.peers.forEach(peer =>{
            if(peer != source){
                peer.send(message);
            }
        });
    }
}


// When peers are not in a room, their room member is set to an instance of 
// EmptyRoom, which contains  callbacks and basic information to signal that
// they are not members of any room.

class EmptyRoom extends Room {
    uuid: string;
    constructor() {
        super(null);
        this.uuid = "";
    }

    removePeer(peer: any) { }

    addPeer(peer: any) { }

    broadcastPeerProperties(peer: any, keys: any) { }

    appendProperties(key: any, value: any) { }

    processMessage(peer: any, message: any) { }

    getPeersArgs() {
        return [];
    }

    getRoomArgs() {
        return {
            uuid: this.uuid,
            joincode: "",
            publish: false,
            name: "",
            keys: [],
            values: []
        }
    }
}