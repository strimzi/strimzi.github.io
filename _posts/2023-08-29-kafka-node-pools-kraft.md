---
layout: post
title: "Kafka Node Pools: KRaft (ZooKeeper-less Apache Kafka)"
date: 2023-08-29
author: jakub_scholz
---

The basic architecture of an Apache Kafka cluster with Apache ZooKeeper is pretty straightforward.
You have a ZooKeeper cluster with one or more ZooKeeper nodes - typically using an odd number of nodes, most often 3.
Then you have the Kafka cluster with one or more Apache Kafka brokers that is bootstrapped using the ZooKeeper cluster.
And that is it, there are no other options.
But without ZooKeeper, everything changes.
In this blog post, we will look at the various KRaft architectures and how Strimzi can support them using the Kafka node pools.

<!--more-->

_This post is part of a series about Kafka node pools.
Other posts include:_

* _[Part 1 - Introduction](https://strimzi.io/blog/2023/08/14/kafka-node-pools-introduction/)_
* _[Part 2 - Node ID Management](https://strimzi.io/blog/2023/08/23/kafka-node-pools-node-id-management/)_
* _[Part 3 - Storage & Scheduling](https://strimzi.io/blog/2023/08/28/kafka-node-pools-storage-and-scheduling/)_
* _Part 4 - KRaft (this post)_

### KRaft architectures

In the KRaft mode, the Kafka cluster runs without an Apache ZooKeeper cluster as a dependency.
The Kafka nodes in the KRaft mode have _controller_ and/or _broker_ roles.
The nodes with the _controller_ role are responsible for maintaining the Kafka metadata, handling leader elections, and helping to bootstrap the Kafka cluster.
They take over the responsibilities originally handled by the ZooKeeper nodes.
The nodes with the _broker_ role have the same responsibilities as the Kafka brokers in the ZooKeeper-based Kafka cluster.
They receive the messages from the producers, store them, and pass them to the consumers.
One node can also have both roles - a controller and a broker -  at the same time.
This creates several different options for how your KRaft-based Kafka cluster might look.

You might start with a small Kafka cluster consisting only of combined nodes that all have both controller and broker nodes.
Typically, it would have three nodes.
But if needed you can also run _a whole Kafka cluster_ in a single node.
Such a cluster is suitable for example for development and testing.
Or - in some cases - it might be even considered for a small production cluster.

![Three-node Kafka cluster with combined nodes](/assets/images/posts/2023-08-29-kafka-node-pools-kraft-combined-nodes.png)

For a big production cluster, you would normally use dedicated controller nodes and dedicated broker nodes.
You would typically keep three controller nodes and as many broker nodes as you need.

![Three-node Kafka cluster with dedicated controller and broker nodes](/assets/images/posts/2023-08-29-kafka-node-pools-kraft-separate-nodes.png)

And somewhere in between is an architecture where some nodes have both controller and broker roles and some have only the broker role.
It is a good fit for example when you run on bare metal and have only beefy worker nodes that you want to be fully utilized and that would be too big to run only the controller node.
It is also an intermediate step when migrating between the previous two architectures. 

![Three-node Kafka cluster with combined nodes](/assets/images/posts/2023-08-29-kafka-node-pools-kraft-semi-combined-nodes.png)

Our users use Strimzi for various use cases from development and test clusters up to large production clusters with many nodes.
So we want to support all of these architectures.
We also want to make it possible to transition between them.
But how do we model the different architectures?
The answer is - using the `KafkaNodePool` resources.

### Node pools and KRaft

KRaft and its various architectures were one of the main motivations when designing node pools.
That is also why KRaft and its roles are directly part of it.
Each `KafkaNodePool` resource has a mandatory field called `roles` in its `spec` section.
We already talked about it already in the [introduction](https://strimzi.io/blog/2023/08/14/kafka-node-pools-introduction/) blog post.
The `roles` field contains a list of roles that the nodes from the node pool should take.
In ZooKeeper-based clusters, the only available role is the `broker` role.
In KRaft-based clusters, you can configure `controller` and/or `broker` roles.
And Strimzi will configure the Kafka nodes belonging to the given pool accordingly.
There always has to be at least one node pool that has the `controller` role and at least one node pool with the `broker` role.
It can be the same node pool for both roles or it can be in a different node pool.
But both roles have to be present to have a working Kafka cluster.
And you can use the roles to configure the various architectures.

So for example, to create the KRaft cluster with combined nodes, you can create one `KafkaNodePool` and configure it to use both roles - `controller` as well as `broker`.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: combined
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  roles:
    - controller
    - broker
  # ...
```

If you want to have a Kafka cluster with a dedicated `controller` and `broker` nodes, you can create two `KafkaNodePool` resources.
One with the `controller` role.
And other with the `broker` node.
Of course, if you want, you can use more node pools.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: controller
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  roles:
    - controller
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: broker
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 6
  roles:
    - broker
  # ...
```

Finally, if you want to use some combined nodes and some broker-only nodes, you can configure the Kafka cluster that way as well.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: combined
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  roles:
    - controller
    - broker
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: broker
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 6
  roles:
    - broker
  # ...
```

You can find full examples of the custom resources on our [GitHub](https://github.com/strimzi/strimzi-kafka-operator/tree/main/examples/kafka/nodepools).
If you want to try it, do not forget that you have to enable the [`UseKRaft` feature gate](https://strimzi.io/docs/operators/0.36.1/full/deploying.html#ref-operator-use-kraft-feature-gate-str) as well.

### Current limitations

While the work on the KRaft support is progressing, it is still not completely ready.
At the time of writing (Strimzi 0.36 / Apache Kafka 3.5.1), there are still some important features missing.
Right now, you can use Strimzi to deploy a Kafka cluster will all of the architectures mentioned earlier.
But Strimzi currently does not support rolling updates of the nodes that have the controller role only.
It also does not support the migration from ZooKeeper to KRaft or upgrades of KRaft clusters.
A full list of the current Strimzi KRaft limitations can be found in our [documentation](https://strimzi.io/docs/operators/latest/full/deploying.html#ref-operator-use-kraft-feature-gate-str).
There are also still many limitations in Apache Kafka itself.
For example missing support for JBOD storage or Admin API support for managing the controller nodes.

So, if you want, give this a try.
But be aware the missing features.

### Conclusion

KRaft might not be production ready yet.
But it's clear, that it is the future of Apache Kafka, and supporting the various KRaft architectures is important for Strimzi.
And the Kafka node pools play a very important role in it.

In the next blog post, we will look closer at some of the future plans we have with node pools.
