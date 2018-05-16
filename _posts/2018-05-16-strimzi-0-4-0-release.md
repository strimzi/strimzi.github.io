---
layout: post
title:  "Strimzi 0.4.0 released!"
date: 2018-04-21
---

We are really happy to announce the new Strimzi 0.4.0 release with a lot of fixes and new interesting features!

<!--more-->

# Enhanced configuration

Until the previous release, just few parameters were exposed through the cluster config map so that the Kafka brokers and Zookeeper nodes configurations were limited. With this release, the `kafka-config` ([doc](http://strimzi.io/docs/0.4.0/#kafka_configuration_json_config)) and the `zookeeper-config` ([doc](http://strimzi.io/docs/0.4.0/#zookeeper_configuration_json_config)) fields were added in order to allow the user to define a full configuration through a JSON string.
Following an example of the `kafka-config` field.

```json
{
  "num.partitions": 1,
  "default.replication.factor": 3,
  "log.retention.hours": 168,
}
```

# Resources usage configuration

It's now possible to specify the Kubernetes/OpenShift resource requests and limits in terms of CPU and memory usage related to the Pods running the cluster nodes. The `kafka-resources` and `zookeeper-resources` fields ([doc](http://strimzi.io/docs/0.4.0/#resources_json_config)) can be used to describe such information using a JSON string.
Following an example.

```json
{
  "requests": {
    "cpu": "1",
    "memory": "2Gi"
  },
  "limits": {
    "cpu": "1",
    "memory": "2Gi"
  }
}
```

It's also possible to configure JVM options through `kafka-jvmOptions` and `zookeeper-jvmOptions` fields ([doc](http://strimzi.io/docs/0.4.0/#jvm_json_config)) like the ones for specifying the initial and maximum heap size, as described in the following example.

```json
{
  "-Xmx": "2g",
  "-Xms": "2g"
}
```

# New Kafka version

Taking into account the improvements in the upstream Kafka project, the Strimzi provided Docker image for the Kafka broker is now updated to the latest 1.1.0 release.

# Conclusion

This release represents a step forward with some new interesting and powerful features other than bug fixes.
Furthermore, because Strimzi is an evolving project, there are some backwards incompatible changes as well; for having more information about them you can refer to the release [changes log](https://github.com/strimzi/strimzi/releases/tag/0.4.0).

What are you waiting for? Engage the community and help us to improve the **only one open source** Apache Kafka operator for running your cluster on Kubernetes/OpenShift!