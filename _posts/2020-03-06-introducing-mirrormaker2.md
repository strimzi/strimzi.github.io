---
layout: post
title:  "Introducing MirrorMaker 2.0 to Strimzi"
date: 2020-03-12
author: paul_mellor
---

Apache Kafka MirrorMaker replicates data between two Kafka clusters, within or across data centers.
MirrorMaker takes messages from a source Kafka cluster and writes them to a target Kafka cluster,
which makes it a very useful tool for those wanting to ensure the availability and consistency of their enterprise data.
And who doesn't?
Typical scenarios where you might consider MirrorMaker are for disaster recovery and increased throughput.

With the release of Strimzi 0.17, things become a little more interesting with the introduction of support for MirrorMaker 2.0.
MirrorMaker 2.0 represents a significant shift in the way you synchronize data between replicated Kafka clusters,
promising a more dynamic and automated approach to topic replication between clusters.

<!--more-->

### MirrorMaker 2.0 - the Kafka Connect(ion)

The previous version of MirrorMaker relies on configuration of a _source producer_ and _target consumer_ pair to synchronize Kafka clusters.

MirrorMaker 2.0 is based on Kafka Connect, which is a bit of a game changer.
For a start, there is no longer a need to configure producers and consumers to make your connection.

With MirrorMaker 2.0 deployed with Strimzi, you identify your source and target clusters.
You then configure and deploy MirrorMaker 2.0 to make the connection between those clusters.

This image shows a single source cluster, but you can have multiple source clusters.

![Connecting clusters with MirrorMaker 2.0](/assets/2020-03-12-mirrormaker.png)

MirrorMaker 2.0 **_connectors_** -- remember, we're based on Kafka Connect now -- and related **_internal topics_** help manage the transfer and synchronization of data between the clusters.

Different to the previous version of MirrorMaker, radically different, but different doesn't mean more complicated here.
In fact, once you know the essentials, setting up is rather straightforward.

Using Strimzi, you just need to work out how you want to configure a `KafkaMirrorMaker2` resource, which will define your MirrorMaker 2.0 deployment.
I'll look a bit more at configuring the `KafkaMirrorMaker2` resource later on.

First, something you'll be keen to know.
Is the sequal better than the original?
Well, how does **_bidirectional replication_** sound?
And what about **_topic configuration synchronization_**  and **_offset tracking_**?
Pretty good, right?

This is MirrorMaker unleashed, ready to fulfill the potential we always knew it had.

### Bidirectional opportunities

In the previous version of MirrorMaker, the topic name in the source cluster is automatically created in the downstream cluster.
Fine, to a point.
But there is no distinction between _Topic-1.Partition-1_ in the source cluster and _Topic-1.Partition-1_ in the target cluster.
Essentially, you are limited to _active/passive_ synchonization.
MirrorMaker 2.0 solves this by introducing the concept of _remote_ topics.

_Remote_ topics are created from the originating cluster by the `MirrorSourceConnector`.
They are distinguished by automatic renaming that appends the name of cluster to the name of the topic.
Our _Topic-1.Partition-1_ from the source cluster becomes the never-to-be-confused _Cluster-1-Topic-1.Partition-1_ in the target cluster.

As you can see here, _remote_ topics can be easily identified so that they are not returned to the source cluster.

![Topic renaming with MirrorMaker 2.0](/assets/2020-03-12-mirrormaker-renaming.png)

Why _remote_ topic and not just _source_ topic?
Because each source cluster can also be a target cluster in a bidirectional configuration.
This feature also means that it is no longer necessary to aggregate data in a separate cluster.

A rose might be a rose by any other name, but when it comes to replicating topics in MirrorMaker 2.0 we can't afford such ambiguity.
Particularly if we want to create a bidirectional configuration.

The approach to topic renaming opens up a world of bidirectional opportunities.
You can now have an _active/active_ cluster configuration that feeds data to and from each cluster.
For this, you need a MirrorMaker 2.0 cluster at each destination.

### Self-regulating topic replication

Topic replication and consumer group replication is defined using regular expression patterns to _whitelist_ or _blacklist_ topics and consumer groups:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
  name: my-mirror-maker2
  spec:
    # ...
    topicsPattern: ".*"
    groupsPattern: "group1|group2|group3"
```

You use `topicsBlacklistPattern` and ` groupsBlacklistPattern` if you want to use blacklists.

Pretty similar to before, but previously topic configuration was not replicated.
The target cluster had to be manually maintained to match topic configuration changes in the source cluster.

This time the topic configuration is now automatically synchronized between source and target clusters through configuration properties.
Configuration changes are propagated to remote topics so that new topics and partitions are detected and created.
The need for rebalancing vanishes.

### Offset tracking and mapping

In the old version of MirrorMaker, the offset of the source topic in the target cluster begins when the replication begins.
The `__consumer-offset topic` is not mirrored.
So offsets of the source topic and its replicated equivalent can have two entirely different positions.
This can be problematic in a failover situation.
How to find the offset in the target cluster?
Strategies such as using timestamps can be adopted, but it adds complexity.

Poof! These issues entirely disappear with MirrorMaker 2.0.
Instead, we get simplicity and sophistication through the `MirrorCheckpointConnector`.

`MirrorCheckpointConnector`
: `MirrorCheckpointConnector` tracks and maps offsets for consumer groups using an _offset sync_ topic and _checkpoint_ topic.
: The _offset sync_ topic maps the source and target offsets for replicated topic partitions from record metadata.
: A _checkpoint_ is emitted from each source cluster and replicated in the target cluster through the _checkpoint_ topic.
: The _checkpoint_ topic maps the last committed offset in the source and target cluster for replicated topic partitions in each consumer group.

### Checking the connection

The old way of checking that MirrorMaker was working was by using standard Kubernetes _healthcheck_ probes to know when MirrorMaker can accept traffic and when it needs a restart.
MirrorMaker 2.0 periodically checks on the connection through its dedicated `MirrorHeartbeatConnector`.

`MirrorHeartbeatConnector`
: `MirrorHeartbeatConnector` periodically checks connectivity between clusters using the _heartbeat_ topic.
: A _heartbeat_ is emitted from each source cluster and replicated in the target cluster through the _heartbeat_ topic.
: The _heartbeat_ topic is used to check that the source cluster is available and the clusters are connected.

### Unleashing MirrorMaker 2.0

Okay, so let's look at how you might approach the configuration of a MirrorMaker 2.0 deployment with the `KafkaMirrorMaker2` resource.

When you define your MirrorMaker 2.0 configuration to set up a connection, you specify the _Source Kafka cluster_ and _target Kafka cluster_, and the bootstrap servers for connection.

If you're sticking with defaults, you don't need to specify much more.
Here's a minimum configuration for MirrorMaker 2.0:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
  name: my-mirror-maker2
  spec:
    version: 2.4.0
    connectCluster: "my-cluster-target"
    clusters:
    - alias: "my-cluster-source"
      bootstrapServers: my-cluster-source-kafka-bootstrap:9092
    - alias: "my-cluster-target"
      bootstrapServers: my-cluster-target-kafka-bootstrap:9092
    mirrors:
    - sourceCluster: "my-cluster-source"
      targetCluster: "my-cluster-target"
      sourceConnector: {}
```

Note that the `spec` includes the Kafka Connect version and cluster alias with the `connectCluster` value,
as we're using a Kafka Connect framework to make our connection.

The `clusters` properties define the Kafka clusters being synchronized, and the `mirrors` properties define the MirrorMaker 2.0 connectors.

You can build a more elaborate configuration.
For example, you can add configuration to include replica nodes, which is the number of replica nodes in the Kafka Connect group, and TLS or SASL authentication for the source and target cluster too.
Typical and sensible choices.

Here we create 3 replica nodes and use TLS authentication.

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
spec:
  version: {DefaultKafkaVersion}
  replicas: 3
  connectCluster: "my-cluster-target"
    clusters:
    - alias: "my-cluster-source"
    authentication:
      certificateAndKey:
        certificate: source.crt
        key: source.key
        secretName: my-user-source
      type: tls
    bootstrapServers: my-cluster-source-kafka-bootstrap:9092
    tls:
      trustedCertificates:
      - certificate: ca.crt
        secretName: my-cluster-source-cluster-ca-cert
  - alias: "my-cluster-target"
    authentication: <10>
      certificateAndKey:
        certificate: target.crt
        key: target.key
        secretName: my-user-target
      type: tls
    bootstrapServers: my-cluster-target-kafka-bootstrap:9092
    config:
      config.storage.replication.factor: 1
      offset.storage.replication.factor: 1
      status.storage.replication.factor: 1
    tls:
      trustedCertificates:
      - certificate: ca.crt
        secretName: my-cluster-target-cluster-ca-cert
```

Often, people get confused by the idea of _replicas_ and _replication through MirrorMaker_,
that's why you'll see replication between clusters referred to as _mirroring_.
Just thought I'd bring that up in case I've been inconsistent in this post.

If you don't want to leave the defaults, you can also include configuration for the **_MirrorMaker 2.0 connectors_** and related **_internal topics_**.

The `config` overrides the default configuration options, so here we alter the replication factors for the **_internal topics_**.
You can see the full `spec` options in the [KafkaMirrorMaker2 schema reference](https://strimzi.io/docs/master/#type-KafkaMirrorMaker2-reference).

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
  spec:
  # ...
    mirrors:
    # ...
    sourceConnector:
      config:
        replication.factor: 1
        offset-syncs.topic.replication.factor: 1
    heartbeatConnector:
      config:
        heartbeats.topic.replication.factor: 1
    checkpointConnector:
      config:
        checkpoints.topic.replication.factor: 1
```

If, at this point, you're wondering what happens if you're using the old version of MirrorMaker.
It's still supported, but you will need to updated to the format supported by MirrorMaker 2.0.

### Embrace change

Apache understood that MirrorMaker was due an overhaul [[KIP-382: MirrorMaker 2.0](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)].
They identified the key issues with using the original MirrorMaker -- manual topic configuration, the lack of support for _active/active_ replication, and the inability to track offsets -- and eradicated them with MirrorMaker 2.0.
The changes are bold, particularly moving to a Kafka Connect foundation.
But the new design works so much better for backup and disaster recovery.

I hope this post has persuaded you of the benefits of MirrorMaker 2.0.
With the release of Strimzi 0.17, you get example files to be able to try it.
Tell us what you think.
