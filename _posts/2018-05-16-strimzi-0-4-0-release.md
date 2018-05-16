---
layout: post
title:  "Strimzi 0.4.0 released!"
date: 2018-04-21
---

We are really happy to announce the new Strimzi 0.4.0 release with a lot of fixes and interesting new features!

<!--more-->

# Enhanced configuration

Until the previous release, just a few parameters were exposed through the cluster config map so that the Kafka brokers and Zookeeper nodes configurations were limited. With this release, the `kafka-config` ([doc](http://strimzi.io/docs/0.4.0/#kafka_configuration_json_config)) and the `zookeeper-config` ([doc](http://strimzi.io/docs/0.4.0/#zookeeper_configuration_json_config)) fields were added in order to allow the user to define a full configuration through a JSON string.
Here's an example of the `kafka-config` field:

```json
{
  "num.partitions": 1,
  "default.replication.factor": 3,
  "log.retention.hours": 168,
}
```

It's possible to do the same within the Kafka Connect config map using the `connect-config` field ([doc](http://strimzi.io/docs/0.4.0/#kafka_connect_configuration_json_config)).

```json
{
  "bootstrap.servers": "my-cluster-kafka:9092",
  "group.id": "my-connect-cluster"
}
```

# Resources usage configuration

It's now possible to specify the Kubernetes/OpenShift resource requests and limits in terms of CPU and memory usage related to the containers running the cluster nodes. The `kafka-resources` and `zookeeper-resources` fields ([doc](http://strimzi.io/docs/0.4.0/#resources_json_config)) can be used to describe such information using a JSON string.
Here's an example:

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

These settings can be even specified for the Topic Operator using the `resources` field within the `topic-operator-config` field available in the cluster config map; in the same way, the `resources` field is used for the Kafka Connect deployment in the related config map.

It's also possible to configure JVM options through `kafka-jvmOptions` and `zookeeper-jvmOptions` fields ([doc](http://strimzi.io/docs/0.4.0/#jvm_json_config)) like the ones for specifying the initial and maximum heap size, as described in the following example.

```json
{
  "-Xmx": "2g",
  "-Xms": "2g"
}
```

The Kafka Connect config map provides the same configuration through the `jvmOptions` ([doc](http://strimzi.io/docs/0.4.0/#kafka_connect_config_map_details)) field as well.

# New Kafka version

The Strimzi Docker images are now based on the 1.1.0 release of Apache Kafka.

# Conclusion

This release represents a step forward with some new interesting and powerful features other than bug fixes.
Furthermore, because Strimzi is an evolving project, there are some backwards incompatible changes as well; for having more information about them you can refer to the release [changes log](https://github.com/strimzi/strimzi/releases/tag/0.4.0).

What are you waiting for? Engage the community and help us to improve the Strimzi project for running your cluster on Kubernetes/OpenShift!