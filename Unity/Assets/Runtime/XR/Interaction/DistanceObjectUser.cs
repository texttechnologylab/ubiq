using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using System.Linq;

namespace Ubiq.XR
{
    public class DistanceObjectUser : MonoBehaviour
    {
        //TODO!!!
        //public delegate void OnDistanceUse(Hand controller, MonoBehaviour go);
        //public delegate void OnDistanceLink(Hand controller, MonoBehaviour go);

        private HandController controller;

        private IDistanceUseable used;

        private void Update()
        {
            if (controller.TriggerState)
            {
                if (used == null)
                {
                    used = PerformRaycast();
                }
            }
            else if (used != null) {
                IDistanceUseable target_used = PerformRaycast();
                if (target_used != null)
                {
                    if (used == target_used)
                    {
                        used.DistanceUse(controller);
                    }
                    else
                    {
                        used.DistanceLink(controller, target_used);
                        
                    }
                }
                used = null;
            }
        }

        private IDistanceUseable PerformRaycast()
        {   
            var Rotation = transform.rotation;
            var Forward = Rotation * Vector3.forward;
            var ray = new Ray(transform.position, Forward);

            var distance = 100f;
            RaycastHit rayHit;
            if (Physics.Raycast(ray, out rayHit, distance, 
                Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
            {
                distance = rayHit.distance;
            }

            IDistanceUseable used_hit = rayHit.collider.gameObject.GetComponentsInParent<MonoBehaviour>().Where(mb => mb is IDistanceUseable).FirstOrDefault() as IDistanceUseable;
            return used_hit;
        }
    }
}