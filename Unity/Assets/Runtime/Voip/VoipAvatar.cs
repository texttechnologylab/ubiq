﻿using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Ubiq.Voip;
using Ubiq.Messaging;

namespace Ubiq.Avatars
{
    public class VoipAvatar : MonoBehaviour
    {
        public Transform audioSourcePosition;
        public VoipPeerConnection peerConnection { get; private set; }

        private Avatar avatar;
        private Transform sinkTransform;
        private VoipPeerConnectionManager peerConnectionManager;
        public AudioRolloffMode rolloffMode = AudioRolloffMode.Logarithmic;

        private void Start()
        {
            avatar = GetComponentInParent<Avatars.Avatar>();
            peerConnectionManager = NetworkScene.Find(this).GetComponentInChildren<VoipPeerConnectionManager>();
            if (peerConnectionManager)
            {
                peerConnectionManager.OnPeerConnection.AddListener(OnPeerConnection, true);
            }
        }

        private void OnDestroy()
        {
            if (peerConnectionManager)
            {
                peerConnectionManager.OnPeerConnection.RemoveListener(OnPeerConnection);
            }
        }

        private void OnPeerConnection(VoipPeerConnection peerConnection)
        {
            if (peerConnection.PeerUuid == avatar.Peer.uuid)
            {
                this.peerConnection = peerConnection;
                var sink = peerConnection.audioSink;
                if(sink is VoipAudioSourceOutput)
                {
                    var voipOutput = sink as VoipAudioSourceOutput;
                    voipOutput.unityAudioSource.rolloffMode = rolloffMode;
                    voipOutput.unityAudioSource.volume = 1.0f;
                    voipOutput.unityAudioSource.spatialBlend = 1.0f;
                    voipOutput.unityAudioSource.maxDistance = 10;
                    voipOutput.unityAudioSource.minDistance = 4;
                    sinkTransform = voipOutput.transform;
                }
            }
        }

        private void LateUpdate()
        {
            if (sinkTransform)
            {
                sinkTransform.position = audioSourcePosition.position;
            }
        }
    }
}
