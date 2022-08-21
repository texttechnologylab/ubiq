using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Ubiq.XR;
using UnityEngine;
using Ubiq.Spawning;
using Ubiq.Messaging;

namespace Ubiq.Samples
{

    /// <summary>
    /// Simple example of a Ball that can be thrown.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class Ball : NetworkBehaviour, IGraspable
    {
        private static int VELOCITY_LENGTH = 5;
        private Vector3[] releaseVelocities = new Vector3[VELOCITY_LENGTH];

        private int updateCount = 0;

        private Hand hand;

        private Rigidbody body;

        public Transform mapPlane;

        private Vector3 orginalPos;

        private Vector3 localGrabPoint;

        private Quaternion localGrabRotation;

        private Vector3 centerOfMass;

        public bool owner;

        public bool released;

        public enum MessageType
        {
            Physics,
            Grab
        }

        public struct Message
        {
            public MessageType type;

            public bool released;

            public TransformMessage transform;

            public bool kinematic;

            public Message(MessageType type, bool released, Transform transform, bool kinematic)
            {
                this.type = type;
                this.released = released;
                this.transform = new TransformMessage(transform);
                this.kinematic = kinematic;
            }
        }

        new protected void Start()
        {
            orginalPos = this.transform.position;
            base.Start();
        }

        private void Awake()
        {
            body = GetComponent<Rigidbody>();
            owner = false;
        }

        public void Grasp(Hand controller, Collider collider)
        {
            hand = controller;
            Transform handTransform = hand.transform;
            localGrabPoint = handTransform.InverseTransformPoint(transform.position);
            localGrabRotation = Quaternion.Inverse(handTransform.rotation) * transform.rotation;

            body.isKinematic = true;
            owner = true;
            SendJson(new Message(MessageType.Grab, false, transform, true));
        }

        public void Release(Hand controller)
        {
            if (controller == hand)
            {
                body.isKinematic = false;
                released = true;
                hand = null;
                SendJson(new Message(MessageType.Grab, true, transform, true));
            }
        }

        private void Update()
        {


            if (mapPlane && mapPlane.position.y > transform.position.y)
            {
                transform.position = orginalPos;
            }
        }

        private void FixedUpdate()
        {
            if (hand)
            {
                var prevPosition = transform.position;
                transform.rotation = hand.transform.rotation * localGrabRotation;
                transform.position = hand.transform.TransformPoint(localGrabPoint);
                releaseVelocities[updateCount % VELOCITY_LENGTH] = (transform.position - prevPosition) / Time.fixedDeltaTime;
                updateCount++;
            }
            if (released)
            {
                Vector3 releaseVelocity = new Vector3(
                releaseVelocities.Average(x => x.x),
                releaseVelocities.Average(x => x.y),
                releaseVelocities.Average(x => x.z));

                body.AddForce(releaseVelocity, ForceMode.Impulse);
                released = false;
            }
            if (owner)
                SendJson(new Message(MessageType.Physics, false, transform, body.isKinematic));

        }

        protected override void ProcessMessage(ReferenceCountedSceneGraphMessage message)
        {

            var msg = message.FromJson<Message>();
            if (msg.type == MessageType.Physics)
            {
                transform.localPosition = msg.transform.position;
                transform.localRotation = msg.transform.rotation;
                body.isKinematic = msg.kinematic;
            }
            else if (msg.type == MessageType.Grab)
            {
                owner = false;
                hand = null;
                body.isKinematic = !msg.released;
            }

        }
    }
}