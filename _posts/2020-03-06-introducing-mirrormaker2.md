---
layout: post
title:  "Introducing MirrorMaker 2.0 to Strimzi"
date: 2020-03-12
author: paul_mellor
---

Apache Kafka MirrorMaker replicates data across two Kafka clusters, within or across data centers.
MirrorMaker takes messages from a source Kafka cluster and writes them to a target Kafka cluster,
which makes it a very useful tool for those wanting to ensure the availability and consistency of their enterprise data.
And who doesn't?
Typical scenarios where you might consider MirrorMaker are for disaster recovery and data aggregation.

With the release of Strimzi 0.17, things become a little more interesting with the introduction of support for MirrorMaker 2.0.
MirrorMaker 2.0 represents a significant shift in the way you synchronize data between replicated Kafka clusters,
promising a more dynamic and automated approach to topic replication between clusters.

<!--more-->

### MirrorMaker 2.0 - the Kafka Connect(ion)

Before we get into some of the implementation detail, there's something you'll be keen to know about Mirror Maker 2.0.
Is the sequel better than the original?
Well, how does **_bidirectional replication_** sound?
And what about **_topic configuration synchronization_**  and **_offset tracking_**?
Pretty good, right?

This is MirrorMaker ready to fulfill the potential we always knew it had.

The previous version of MirrorMaker relies on configuration of a _source consumer_ and _target producer_ pair to synchronize Kafka clusters.

MirrorMaker 2.0 is instead based on Kafka Connect, which is a bit of a game changer.
For a start, there is no longer a need to configure producers and consumers to make your connection.

Using MirrorMaker 2.0, you just need to identify your source and target clusters.
You then configure and deploy MirrorMaker 2.0 to make the connection between those clusters.

This image shows a single source cluster, but you can have multiple source clusters, which is something that was not possible with old MirrorMaker.

![Connecting clusters with MirrorMaker 2.0](/assets/2020-03-12-mirrormaker.png)

MirrorMaker 2.0 _connectors_ -- remember, we're based on Kafka Connect now -- and related _internal topics_ (_offset sync_, _checkpoint_ and _heartbeat_) help manage the transfer and synchronization of data between the clusters.

Using Strimzi, you configure a `KafkaMirrorMaker2` resource to define the Kafka Connect deployment, including the connection details of the source and target clusters, and start running a set of MirrorMaker 2.0 connectors to make the connection.

Different to the previous version of MirrorMaker, radically different, but different doesn't mean more complicated here.
In fact, once you know the essentials, setting up is rather straightforward.

### Bidirectional opportunities

In the previous version of MirrorMaker, the topic name in the source cluster is automatically created in the downstream cluster.
Fine, to a point.
But there is no distinction between _Topic-1.Partition-1_ in the source cluster and _Topic-1.Partition-1_ in the target cluster.
Essentially, you are limited to _active/passive_ synchronization, because _active/active_ replication would cause an infinite loop.
MirrorMaker 2.0 solves this by introducing the concept of _remote_ topics.

_Remote_ topics are created from the originating cluster by the `MirrorSourceConnector`.
They are distinguished by automatic renaming that prepends the name of cluster to the name of the topic.
Our _Topic-1.Partition-1_ from the source cluster becomes the never-to-be-confused _Cluster-1-Topic-1.Partition-1_ in the target cluster.
A consumer in the target cluster can consume _Topic-1.Partition-1_ and  _Cluster-1-Topic-1.Partition-1_ and maintain unambiguous consumer offsets.

As you can see here, _remote_ topics can be easily identified, so there's no possibility of messages being sent back and forth in a loop.

![Topic renaming with MirrorMaker 2.0](/assets/2020-03-12-mirrormaker-renaming.png)

Why _remote_ topic and not just _source_ topic?
Because each source cluster can also be a target cluster in a bidirectional configuration.
This feature also means that it is no longer necessary to aggregate data in a separate cluster.

A rose might be a rose by any other name, but when it comes to replicating topics in MirrorMaker 2.0 we can't afford such ambiguity.
Particularly if we want to create a bidirectional configuration.

The approach to topic renaming opens up a world of bidirectional opportunities.
You can now have an _active/active_ cluster configuration that feeds data to and from each cluster.
For this, you need a MirrorMaker 2.0 cluster at each destination, as shown in the previous image.

### Self-regulating topic replication

Topic replication is defined using regular expression patterns to _whitelist_ or _blacklist_ topics:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
  name: my-mirror-maker2
spec:
  # ...
  mirrors:
  - sourceCluster: "my-cluster-source"
    targetCluster: "my-cluster-target"
    topicsPattern: ".*"
    # ...
```

You use `topicsBlacklistPattern` if you want to use blacklists.

This is pretty similar to MirrorMaker, but previously topic _configuration_ was not replicated.

The target cluster had to be manually maintained to match topic configuration changes in the source cluster.
Something easily overlooked, and typically requiring users to build their own automation to achieve at scale.

With MirrorMaker 2.0, the topic configuration is automatically synchronized between source and target clusters according to the topics defined in the `MirrorMaker2` custom resource.
Configuration changes are propagated to remote topics so that new topics and partitions are detected and created.
By keeping topic properties synchronized, the need for consumer rebalancing due to topic changes is greatly reduced.

### Offset tracking and mapping

In the previous version of MirrorMaker, the consumer offset of the source topic in the target cluster begins when the replication begins.
The `__consumer_offsets` topic is not mirrored.
So offsets of the source topic and its replicated equivalent can have two entirely different positions.
This was often problematic in a failover situation.
How to find the offset in the target cluster?
Strategies such as using timestamps can be adopted, but it adds complexity.

These issues entirely disappear with MirrorMaker 2.0.
Instead, we get simplicity and sophistication through the `MirrorCheckpointConnector`.

`MirrorCheckpointConnector` tracks and maps offsets for specified consumer groups using an _offset sync_ topic and _checkpoint_ topic.
The _offset sync_ topic maps the source and target offsets for replicated topic partitions from record metadata.
A _checkpoint_ is emitted from each source cluster and replicated in the target cluster through the _checkpoint_ topic.
The _checkpoint_ topic maps the last committed offset in the source and target cluster for replicated topic partitions in each consumer group.

If you want automatic failover, you can use Kafka's new `RemoteClusterUtils.java` utility class by adding `connect-mirror-client` as a dependency to your consumers.

```xml
<dependency>
    <groupId>org.apache.kafka</groupId>
    <artifactId>connect-mirror-client</artifactId>
    <version>2.4.0</version>
</dependency>
```
The class translates the consumer group offset from the source cluster to the corresponding offset for the target cluster.

The consumer groups tracked by `MirrorCheckpointConnector` are dependent on those defined in a _whitelist_ or _blacklist_:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
  name: my-mirror-maker2
spec:
  # ...
  mirrors:
  - sourceCluster: "my-cluster-source"
    targetCluster: "my-cluster-target"
    groupsPattern: "group1|group2|group3"
    # ...
```

You use `groupsBlacklistPattern` if you want to use blacklists.

### Checking the connection

The old way of checking that MirrorMaker was working, on Kubernetes at least, was by using standard Kubernetes _healthcheck_ probes to know when MirrorMaker can accept traffic and when it needs a restart.
MirrorMaker 2.0 periodically checks on the connection through its dedicated `MirrorHeartbeatConnector`.

`MirrorHeartbeatConnector` periodically checks connectivity between clusters.
A _heartbeat_ is produced every second by the `MirrorHeartbeatConnector` into a _heartbeat_ topic that is created on the local cluster.
If you have MirrorMaker 2.0 at both the remote and local locations, the _heartbeat_ emitted at the remote location by the `MirrorHeartbeatConnector` is treated like any remote topic and mirrored by the `MirrorSourceConnector` at the local cluster.
The _heartbeat_ topic makes it easy to check that the remote cluster is available and the clusters are connected.
If things go wrong, the _heartbeat_ topic offset positions and time stamps can help with recovery and diagnosis.  

### Unleashing MirrorMaker 2.0

Okay, so let's look at how you might approach the configuration of a MirrorMaker 2.0 deployment with the `KafkaMirrorMaker2` resource.

When you define your MirrorMaker 2.0 configuration to set up a connection, you specify the `sourceCluster` and `targetCluster`, and the `bootstrapServers` for connection.

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
  name: my-mirror-maker2
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
    authentication:
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

People can be confused by the idea of _replicas_ and _replication_ through MirrorMaker,
that's why you'll see replication between clusters often referred to as _mirroring_ so that it's not confused with
the `replicas` that represent the nodes replicated in a deployment.

If you don't want to leave the defaults, you can also include configuration for the _MirrorMaker 2.0 connectors_ and related _internal topics_.

The `config` overrides the default configuration options, so here we alter the replication factors for the _internal topics_:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaMirrorMaker2
metadata:
  name: my-mirror-maker2
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

You can see the full `spec` options in the [KafkaMirrorMaker2 schema reference](https://strimzi.io/docs/latest/#type-KafkaMirrorMaker2-reference).

If, at this point, you're wondering what happens if you're using the old version of MirrorMaker,
it's still supported.
And there are also plans to have a _legacy mode_ in MirrorMaker 2.0 that creates topics without the cluster prefix,
and doesn't do the topic configuration mirroring.
Basically, turning off the main differences between the original and the new version of MirrorMaker.

### Embrace change

The Apache Kafka community understood that MirrorMaker was due an overhaul [[KIP-382: MirrorMaker 2.0](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382%3A+MirrorMaker+2.0)].
Key issues with using the original MirrorMaker were identified -- manual topic configuration, the lack of support for _active/active_ replication, and the inability to track offsets -- and eradicated with MirrorMaker 2.0.
The changes are bold, particularly moving to a Kafka Connect foundation.
But the new design works so much better, particularly for backup and disaster recovery.

I hope this post has persuaded you of the benefits of MirrorMaker 2.0.
With the release of Strimzi 0.17, you get example files to be able to try it.
Tell us what you think.
