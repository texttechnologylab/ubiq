﻿using UnityEngine;
using UnityEditor;
using System.IO;
using System;
using Ubiq.Networking;
using Ubiq.Rooms;

namespace Ubiq.Utilities
{
    public static class SamplesHelper
    {
        /// <summary>
        /// Generates configuration files for the Browser and Node samples
        /// that reflect the current settings in the Nexus and Sample Room
        /// assets.
        /// Use this if you have changed these assets and wish to make sure
        /// both the Unity and other platform samples continue to join the
        /// same room.
        /// </summary>
        [MenuItem("Ubiq/Update Sample Configs")]
        public static void UpdateSampleConfigs()
        {
            UpdateSampleConfigs(false);
        }

        public static void UpdateSampleConfigs(bool silent)
        {
            // The config files generated by this function are only meaningful
            // to the other platform samples provided in the full Ubiq checkout.
            // If not (say we are running from the Unity Package Manager) then
            // don't do anything because we can't assume anything about the
            // users directory structure.

            if (IsFullCheckout())
            {
                UpdateExternalConfigs();
            }
            else if (!silent)
            {
                Debug.LogWarning("Ubiq is installed as a UPM package, so no sample configs need updating.");
            }
        }

        private static bool IsFullCheckout()
        {
            var assembly = System.Reflection.Assembly.GetExecutingAssembly();
            var packageInfo = UnityEditor.PackageManager.PackageInfo.FindForAssembly(assembly);
            return packageInfo == null;
        }

        [Serializable]
        struct ServerConfig
        {
            public string uri;
            public string port;
        }

        [Serializable]
        struct SamplesConfig
        {
            public ServerConfig tcp;
            public ServerConfig wss;
            public string room;
        }

        /// <summary>
        /// This method updates configuration files for samples outside the
        /// Unity project, if the project is part of a local checkout. If Ubiq
        /// has been downloaded as a Unity Package, this method will do nothing.
        /// </summary>
        private static void UpdateExternalConfigs()
        {
            SamplesConfig config = new SamplesConfig();

            foreach (var guid in AssetDatabase.FindAssets("Nexus"))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var type = AssetDatabase.GetMainAssetTypeAtPath(path);
                if (type == typeof(ConnectionDefinition))
                {
                    var asset = AssetDatabase.LoadMainAssetAtPath(path) as ConnectionDefinition;
                    config.tcp.uri = asset.sendToIp;
                    config.tcp.port = asset.sendToPort;
                    foreach (var item in asset.platforms)
                    {
                        if (item.platform == RuntimePlatform.WebGLPlayer)
                        {
                            config.wss.uri = item.connection.sendToIp;
                            config.wss.port = item.connection.sendToPort;
                        }
                    }
                }
            }
            foreach (var guid in AssetDatabase.FindAssets("Sample Room"))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var type = AssetDatabase.GetMainAssetTypeAtPath(path);
                if (type == typeof(RoomGuid))
                {
                    var asset = AssetDatabase.LoadMainAssetAtPath(path) as RoomGuid;
                    config.room = asset.Guid;
                }
            }

            UpdateExternalConfig(Path.Combine(Environment.CurrentDirectory, "..", "Node", "config", "samples.json"), config);
            UpdateExternalConfig(Path.Combine(Environment.CurrentDirectory, "..", "Browser", "config.json"), config);
        }

        private static void UpdateExternalConfig(string filename, SamplesConfig config)
        {
            File.WriteAllText(filename, JsonUtility.ToJson(config));
        }
    }
}