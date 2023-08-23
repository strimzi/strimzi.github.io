---
layout: post
title: "Kafka Node Pools: Node ID Management"
date: 2023-08-23
author: jakub_scholz
---

One of the features Strimzi users sometimes ask for is how to remove a broker with some specific broker ID.
This was not possible in the past when StatefulSets allowed Strimzi to remove only the broker with the highest broker ID.
But with Kafka node pools, it is now possible.
And in this blog post we will have a look at how to do it and show some other tricks related to the node IDs as well.

<!--more-->

_This post is part of a bigger series about Kafka node pools.
The other parts published so far are:_

* _[Part 1 - Introduction](https://strimzi.io/blog/2023/08/14/kafka-node-pools-introduction/)_
* _Part 2 - Node ID Management (this post)_

### Assigning node IDs

By default, Strimzi will automatically assign a new node ID to each Kafka node.
It will start from 0 and continue with 1, 2 and so on, always incrementing by one.
When you scale your Kafka cluster up, it will find the next free node ID and use it.
When you scale down your Kafka cluster, it will remove the highest used node ID first.

When you have only one node pool, assigning node IDs works exactly same way as without node pools.
When you create the node pool with 3 nodes, it will be assigned node IDs 0, 1, and 2.
When you scale it up to 4 nodes, the new node will get the ID 3.
When you scale it down to 2 nodes, the node with ID 2 will be removed and your cluster will have only the IDs 0 and 1.

But when you add more node pools into mix, things start to be more complicated.
For example, imagine you have two node pools with 3 replicas each.
When you deploy the cluster, the first node pool will get the IDs 0, 1, and 2.
And the second node pool will get the node IDs 3, 4, and 5.
But when you scale the first node pool up and add two more nodes, it cannot get the node IDs 3 and 4 anymore because they are already used.
So it will get the node IDs 6 and 7 and the first node pool will now have node IDs 0, 1, 2, 6, and 7.
Similarly, when you scale down the second pool and remove two nodes, we cannot scale down the node with IDs 6 and 7 because they belong to the first pool.
It will instead remove the Kafka nodes with the highest node IDs from the second pool, which are the nodes with IDs 4 and 5.

Technically, this works perfectly fine.
But it can easily get a bit confusing when managing and monitoring the Kafka cluster.
After the scale up and scale down, our cluster now has node IDs 0, 1, 2, 3, 6, and 7.
And out of that, the node IDs 0, 1, 2, 6, and 7 belong to the first node pool.
And node ID 3 belongs to the second node pool.

This can easily get confusing.
Imagine your Kafka cluster is running for several years and there were many different changes, scale-ups and scale-downs over the period.
When someone calls you in the middle of the night about a production issue on node 6, will you remember the node pool it belongs to?
Or what configuration does it use?
We thought about this and prepared a way for you to assign a specific range of node IDs for each node pool.

### Assigning node ID ranges to node pools

You can use the `strimzi.io/next-node-ids` annotation on the `KafkaNodePool` resource to tell Strimzi what node IDs should be used when a new node is being added to the node pool.
The annotation can contain one or more IDs or ID ranges.
It looks like this:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-b
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[100-199]"
spec:
  # ...
```

It has no impact on any nodes and their node IDs which might already exist in the node pool.
But when a new node is created, Strimzi will find the lowest available node ID from this range and use it.
If all node IDs from the range are already in use, Strimzi uses the lowest available node ID outside of this range.
If you want, you can also combine multiple ranges or use individual node IDs: `"[5, 8, 10-15, 18, 20-25]"`.

Let's imagine the same situation as we discussed in the previous section. We create two node pools with 3 replicas each, but this time using their own node ID ranges:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-a
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[0-99]"
spec:
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-b
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[100-199]"
spec:
  # ...
```

When they are first deployed, the node IDs in the first pool will be 0, 1, and 2.
And the node IDs in the second pool will be 100, 101, and 102.
After the scale up, the first node pool uses node IDs 0, 1, 2, 3 and 4.
After the scale down, the second node pool uses node ID 100.
Since each node pool has its own range of node IDs, they do not mix and it is much easier to see which node pool the node ID belongs to.

If you want, you can also use the range notation in reverse order where it starts from the higher number - `"[99-0]"`.
In that case, the operator will use the highest available number from this range first.
With that, you can do something like this:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-a
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[0-99]"
spec:
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-b
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[99-0]"
spec:
  # ...
```

In this case, both node pools share the same range.
But one of them starts using the node IDs from 0 and other one from 99.
So the first pool will have IDs 0, 1, and 2.
And the second pool will get IDs 99, 98, and 97.

#### What is the maximum node ID?

One important thing to keep in mind when customizing the node IDs used by the different node pools is that by default, Apache Kafka lets you use only IDs from 0 to 999.
This is controlled by the [`reserved.broker-max.id`](https://kafka.apache.org/documentation/#brokerconfigs_reserved.broker.max.id) option in Kafka brokers.
So, if you want to use node IDs bigger then 999, you have to change this setting in the `Kafka` custom resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/node-pools: enabled
spec:
  kafka:
    config:
      reserved.broker.max.id: 10000
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-a
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[1000-1999]"
spec:
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-b
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[2000-2999]"
spec:
  # ...
```

### Scaling down a specific broker

The `strimzi.io/next-node-ids` annotation is used when new nodes are added.
Its counterpart is the `strimzi.io/remove-node-ids` annotation.
It is used to define which node IDs (and which Kafka nodes) should be removed first when scaling down.
It uses the same format as the `strimzi.io/next-node-ids` annotation.
When the `strimzi.io/remove-node-ids` annotation is not set, Strimzi will always remove the node with the highest used node ID first.
So if you are fine with this, you do not need to use it.

But when you want to remove a specific Kafka node from the cluster as discussed in the beginning, this is the way to do it.
For example, imagine we have a Kafka cluster with one node pool which has three Kafka nodes with IDs 100, 101, and 102:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-a
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[100-199]"
spec:
  replicas: 3
  # ...
status:
  # ...
  nodeIds:
    - 100
    - 101
    - 102
```

And you want to remove the node with ID 101.
How do you do it?

1. First you have to annotate the node pool with the `strimzi.io/remove-node-ids` annotation and set it to the ID `101`:
   ```
   kubectl annotate kafkanodepool pool-a strimzi.io/remove-node-ids="[101]"
   ```
2. And then you scale-down the node pool to 2 replicas:
   ```
   kubectl scale kafkanodepool pool-a --replicas=2
   ```
   Strimzi will scale down the Kafka cluster and remove the node with ID 101.
3. Once the scale-down is finished, the `strimzi.io/remove-node-ids` annotation would not be needed anymore and will be ignored by the operator.
   So you can remove it:
   ```
   kubectl annotate kafkanodepool pool-a strimzi.io/remove-node-ids-
   ```

And as a result of this, your cluster will now have only two nodes with IDs 100 and 102:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-a
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/next-node-ids: "[100-199]"
spec:
  replicas: 2
  # ...
status:
  # ...
  nodeIds:
    - 100
    - 102
```

### Conclusion

If you are looking to have more control over managing Kafka node IDs, this post has shown how node pools can really help.
In the next post in this series, we'll continue exploring the benefits of using node pools in other situations. 
