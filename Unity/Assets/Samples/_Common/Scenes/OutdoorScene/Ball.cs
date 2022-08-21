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
        private Hand follow;
        private Rigidbody body;

        private Vector3 releaseVelocity;

        public Transform mapPlane;

        private Vector3 orginalPos;

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

        public void Grasp(Hand controller)
        {
            follow = controller;
            body.isKinematic = true;
            owner = true;
            SendJson(new Message(MessageType.Grab, false, transform, true));
        }

        public void Release(Hand controller)
        {
            if (controller == follow)
            {
                body.isKinematic = false;
                released = true;
                follow = null;
                SendJson(new Message(MessageType.Grab, true, transform, true));
            }
        }

        private void Update()
        {
            if (follow)
            {
                releaseVelocity = (follow.transform.position - transform.position) / Time.fixedDeltaTime;
                transform.position = follow.transform.position;
                transform.rotation = follow.transform.rotation;
            }
            if (released)
            {
                body.AddForce(releaseVelocity, ForceMode.Impulse);
                released = false;
            }
            if (mapPlane && mapPlane.position.y > transform.position.y)
            {
                transform.position = orginalPos;
            }
        }

        private void LateUpdate()
        {
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
                follow = null;
                body.isKinematic = !msg.released;
            }

        }
    }
}