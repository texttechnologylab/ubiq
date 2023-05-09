using System.Linq;
using UnityEngine;

namespace Ubiq.XR
{
    /// <summary>
    /// Uses the object under the cursor.
    /// </summary>
    [RequireComponent(typeof(DesktopHand))]
    public class DistanceObjectDesktopUser : MonoBehaviour
    {
        public IDistanceUseable used;
        public Camera mainCamera;

        private DesktopHand hand;

        private void Awake()
        {
            hand = GetComponent<DesktopHand>();
        }

        private void Update()
        {
            TestUse();
        }

        private void TestUse()
        {
            if (Input.GetMouseButtonDown(0))
            {
                if (used == null)
                {
                    used = PerformRaycast();
                }
            }
            else if (used != null)
            {
                IDistanceUseable target_used = PerformRaycast();
                if (used == target_used)
                {
                    Debug.Log("!!!!!Using " + used);
                    used.DistanceUse(hand);
                }
                else
                {
                    Debug.Log("!!!!!Linking " + used + " to " + target_used);
                    used.DistanceLink(hand, target_used);
                }
                used = null;
            }
        }

        private IDistanceUseable PerformRaycast()
        {
            var mainCamera = FindCamera();

            RaycastHit hit = new RaycastHit();
            if (!Physics.Raycast(mainCamera.ScreenPointToRay(Input.mousePosition).origin,
                                 mainCamera.ScreenPointToRay(Input.mousePosition).direction, out hit, 100,
                                 Physics.DefaultRaycastLayers)
            )
            {
                return null;
            }

            used = hit.collider.gameObject.GetComponentsInParent<MonoBehaviour>().Where(mb => mb is IDistanceUseable).FirstOrDefault() as IDistanceUseable;
            return used;
        }

        private Camera FindCamera()
        {
            if (mainCamera != null)
            {
                return mainCamera;
            }

            return Camera.main;
        }
    }
}