---
layout: post
title: "Kafka Node Pools: What's next?"
date: 2023-08-31
author: jakub_scholz
---

In the previous blog posts, we focused on the improvements that node pools deliver already today.
In this blog post - the last one in this series - we will look towards the future.
We will talk about the next steps and possible future improvements.

<!--more-->

_This post is part of a series about Kafka node pools.
Other posts include:_

* _[Part 1 - Introduction](https://strimzi.io/blog/2023/08/14/kafka-node-pools-introduction/)_
* _[Part 2 - Node ID Management](https://strimzi.io/blog/2023/08/23/kafka-node-pools-node-id-management/)_
* _[Part 3 - Storage & Scheduling](https://strimzi.io/blog/2023/08/28/kafka-node-pools-storage-and-scheduling/)_
* _[Part 4 - Supporting KRaft (ZooKeeper-less Apache Kafka)](https://strimzi.io/blog/2023/08/28/kafka-node-pools-supporting-kraft/)_
* _Part 5 - What's next? (this post)_

### Feature gate graduation

Kafka node pools are currently behind a `KafkaNodePools` feature gate and are disabled by default.
Over the next Strimzi releases, we will continue to work on improving them
We will improve the test coverage in our unit, integration, and system tests.
We will also continue fixing the bugs that might be still in the code.

The current plan is that in the Strimzi 0.39 release, the `KafkaNodePools` feature gate will be promoted to the beta phase and enabled by default.
Finally, in Strimzi 0.41, it will graduate to GA and it will not be possible to disable it anymore.
The schedule is of course _subject to change_.
It might be adjusted depending on the feedback we receive from you or based on the number of bugs we will discover.
Keep in mind, that just because the feature gate is enabled, you do not have to use the `KafkaNodePool` resources.
You can continue using the `Kafka` resource only and the operator will internally convert it to what we call a _virtual node pool_ that exists only in the memory of the Strimzi Cluster Operator.
This ensures that we provide good backward compatibility and can guarantee smooth migration.

In parallel to the work on improving the node pools, we will also continue the work on the KRaft support to address the remaining limitations.
The migration from ZooKeeper-based Kafka clusters to KRaft will be the main turning point where everyone will have to start using the `KafkaNodePool` resources.
Already today, if you want to try the KRaft mode, you have to do it using the `KafkaNodePool` resources.
As Apache Kafka completes the work on the KRaft mode and completely drops support for ZooKeeper, everyone will migrate from ZooKeeper-based to KRaft-based Kafka clusters.
And as part of this migration, all Strimzi users will also move to use the `KafkaNodePool` resources.

#### Strimzi `v1` APIs

Once the migration to KRaft and node pools moves forward, we will also start working on the Strimzi `v1` API.
Evolving the APIs of the Custom Resources can be complicated.
However, once the ZooKeeper support is removed from Apache Kafka and Strimzi, we will be able to remove the ZooKeeper-related options from the `Kafka` custom resource definition.
We will be also able to remove the options that moved into the `KafkaNodePool` resources such as the number of replicas or storage configuration.

### More configurable options

The `KafkaNodePool` resource currently supports only a limited number of configuration options:
* Number of replicas in that pool
* Role(s) of the nodes in this pool
* The storage configuration
* Resource requirements (e.g. memory and CPU)
* JVM configuration options
* Template for customizing the resources belonging to this pool, such as pods or containers

This is something that might be expanded in the future.
For some options, it would probably never make sense to configure them at the node pool level.
This would for example include the cluster-wide configurations such as authorization or listeners.
On the other hand, many other options can be easily made configurable at the node pool level if they provide some value.

Would there be some use case to configure a different container image for each node pool?
Different metrics or logging configurations?
Tuning some of the Kafka configuration options that can be applied on a per-node level?
If you have a use case for any of these, feel free to let us know for example in GitHub Discussions or Issues and we can have a look.

### Moving nodes

One of the last features mentioned in the original [node pool proposal](https://github.com/strimzi/proposals/blob/main/050-Kafka-Node-Pools.md) but not implemented yet is support for moving nodes from one node pool to another.
If you want to move a node from one node pool to another today, you have to:
1. Create a new node in the target node pool
2. Move data from the old node to the new node (for example using Cruise Control)
3. Remove the node from the original node pool

As part of this procedure, the node ID will change.
The new Kafka node will get a new ID and the old node ID will be removed after the old node is dropped.
But this procedure works well with maintaining the availability of the Apache Kafka cluster.
While the data are being moved in the second step, the original partition-replicas are still available and can be used by clients if needed.
You can also easily configure the speed at which the data should be moved to make sure it does not harm the performance of your Kafka cluster.

But in some situations, this approach might be complicated.
Because you are running the new node and the old node in parallel, you need to have sufficient resources available in your Kubernetes cluster.
And when your Kubernetes cluster has only limited resources available - for example when running at the edge - this might be a problem.
Being able to move the Kafka node directly would solve this problem.

Just to be clear, the node pools might have completely different configurations.
So Strimzi cannot just take the pod and _rename it_.
It would need to drop the old Kafka node including its storage.
And then create a new node with a new empty storage.
And the new node will then need to re-sync all the partition-replicas from the other node.

This might take a lot of time.
And while the data are being re-synced, your topics will be without the replicas hosted by this node and the availability guarantees of your Kafka cluster might be weakened.
So, in most situations, we would recommend our users to use the first approach anyway.
But moving the nodes might be useful in some niche situations, so we might get back to it and eventually implement it.

### Stretch clusters

Today, the whole Strimzi-based Apache Kafka cluster always runs on a single Kubernetes cluster.
One of the _stretch_ goals of Kafka node pools is to add support for _stretch_ clusters - clusters that are stretched over multiple Kubernetes clusters.
Imagine, that each node pool will not only have a different storage configuration or number of replicas.
But it will also configure the Kubernetes cluster where these Kafka nodes should run.
Strimzi will automatically deploy the pods with the Kafka nodes in the different Kubernetes clusters and link them together to form a single stretched Apache Kafka cluster.

To cool down your excitement a bit.
The stretched cluster support in Strimzi will not make it possible to run Kafka nodes belonging to some clusters in completely different regions or even on different continents.
The Kafka cluster will still be limited by the latency between the different Kubernetes clusters.
But even with that in mind, it would add some value.
Some users prefer to stretch the Kafka cluster over multiple Kubernetes clusters like this to improve the overall availability.

It would also make it possible to migrate the Kafka cluster from one Kubernetes cluster to another.
You can move the nodes one by one until they are all moved then then you can just decommission the old Kubernetes cluster.
This all can be done while maintaining the availability of the Kafka cluster and without the need to have two clusters and use mirroring to migrate between them.

The stretch cluster feature is not something you should expect anytime soon.
We might look into it at some point next year.

### Conclusion

This is the last part of this blog post series.
Hopefully, over the five parts we managed to show you how to use the node pools and explain some of the motivations behind them.
Give it a try and we will be looking forward to your feedback, raised bugs, feature requests, or PRs.
