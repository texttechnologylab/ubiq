using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using System;

namespace Ubiq.XR
{

    public delegate void OnGrasp(Hand controller, MonoBehaviour go);
    public delegate void OnRelease(Hand controller, MonoBehaviour go);

    /// <summary>
    /// This interacts with Components that implement IGraspable, when its trigger collider enters their collider.
    /// </summary>
    public class GraspableObjectGrasper : MonoBehaviour
    {
        public HandController controller;

        private Collider contacted;
        private IGraspable grasped;
        public static OnGrasp onGrasp = delegate {};
        public static OnRelease onRelease = delegate {};
        private void Start()
        {
            controller.GripPress.AddListener(Grasp);
        }

        public void Grasp(bool grasp)
        {
            if (grasp)
            {
                if (contacted != null)
                {
                    // parent because physical bodies consist of a rigid body, and colliders *below* it in the scene graph
                    grasped = contacted.gameObject.GetComponentsInParent<MonoBehaviour>().Where(mb => mb is IGraspable).FirstOrDefault() as IGraspable;
                    grasped.Grasp(controller);
                    onGrasp.Invoke(controller, grasped as MonoBehaviour);
                    
                }
            }
            else
            {
                if (grasped != null)
                {
                    grasped.Release(controller);
                    onRelease.Invoke(controller, grasped as MonoBehaviour);
                    grasped = null;
                }
            }
        }

        // *this* collider is the trigger
        private void OnTriggerEnter(Collider collider)
        {
            if(collider.gameObject.GetComponentsInParent<MonoBehaviour>().Where(mb => mb is IGraspable).FirstOrDefault() != null)
            {
                contacted = collider;
            }
        }

        private void OnTriggerExit(Collider collider)
        {
            if (contacted == collider)
            {
                contacted = null;
            }
        }
    }
}