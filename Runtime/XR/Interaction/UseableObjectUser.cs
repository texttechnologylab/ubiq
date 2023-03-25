using System.Collections.Generic;
using UnityEngine;
using System;

namespace Ubiq.XR
{
    public delegate void OnUse(Hand controller, MonoBehaviour go);
    public delegate void OnUnUse(Hand controller, MonoBehaviour go);
    public class UseableObjectUser : MonoBehaviour
    {
        public HandController controller;

        public List<Collider> contacted;
        public List<IUseable> used;
        public static OnUse onUse = delegate {};
        public static OnUnUse onUnUse = delegate {};

        private void Awake()
        {
            contacted = new List<Collider>();
            used = new List<IUseable>();
        }

        // Start is called before the first frame update
        private void Start()
        {
            controller.TriggerPress.AddListener(Use);
        }

        private void Use(bool state)
        {
            if(state)
            {
                for (int i = 0; i < contacted.Count; i++)
                {
                    var item = contacted[i];
                    if (item == null || !item)
                    {
                        // Item was destroyed while in contact - remove it
                        contacted.RemoveAt(i);
                        i--;
                        continue;
                    }

                    foreach (var component in item.GetComponentsInParent<MonoBehaviour>())
                    {
                        if(component is IUseable)
                        {
                            var useable = (component as IUseable);
                            useable.Use(controller);
                            onUse.Invoke(controller, component);
                            used.Add(useable);
                        }
                    }
                }
            }
            else
            {
                for (int i = 0; i < used.Count; i++)
                {
                    var item = used[i];
                    if (item == null)
                    {
                        // Don't need to remove - collection is cleared soon
                        continue;
                    }

                    item.UnUse(controller);
                    onUse.Invoke(controller, item as MonoBehaviour);
                }
                used.Clear();
            }
        }

        // *this* collider is the trigger
        private void OnTriggerEnter(Collider collider)
        {
            if(!contacted.Contains(collider))
            {
                contacted.Add(collider);
            }
        }

        private void OnTriggerExit(Collider collider)
        {
            contacted.Remove(collider);
        }
    }
}