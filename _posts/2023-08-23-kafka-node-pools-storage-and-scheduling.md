---
layout: post
title: "Kafka Node Pools: Storage & Scheduling"
date: 2023-08-23
author: jakub_scholz
---

Another two areas where Kafka Node Pools might be helpful is around storage and its management, and scheduling of pods.
And in this third blog post in our series about node pools, we will look into these areas in more detail.

<!--more-->

_This post is part of a bigger series about Kafka Node Pools.
The other parts published so far are:_

* _[Part 1 - Introduction](https://strimzi.io/blog/2023/08/14/kafka-node-pools-introduction/)_
* _[Part 2 - Node ID Management](https://strimzi.io/blog/2023/08/23/kafka-node-pools-node-id-management/)_
* _Part 3 - Storage & Scheduling (this post)_

### Storage Management

Most of the time, storage is a completely boring area.
You deploy your Apache Kafka cluster, it provisions the persistent volumes ... and that is it for a long time.
The cluster will be running, storing new messages to the disks, reading them when requested by consumers, and finally deleting them when they are beyond their retention.
And through all of this, you do not need to do anything about the storage
It just works.

But from time to time, there will be some special requirements.
Perhaps you need to expand the size of the disks because your brokers need to handle more data.
Maybe you decommissioned some projects and your disks are now too big, so you want to shrink them.
Or maybe you want to change the storage class used by the volumes and move to a new more performant or cheaper storage type.

Some of these are easy to handle.
For example, increasing storage capacity is supported by Kubernetes on many different infrastructures.
All you need to do is edit the `Kafka` custom resource and increase the volume size.

But others are a bit harder.
If you want to change the storage class or shrink the disk size and use `type: jbod` storage (even if it is only with one volume), you have to go through this procedure:
1. Add the new volume to the JBOD list with the new size or storage class
2. Move all partitions from the old disk to the new disk
3. Remove the old disk from the list of the JBOD disks

This sounds easy.
Unfortunately, Cruise Control currently does not support moving everything from one disk to another (there is an open PR [#1908](https://github.com/linkedin/cruise-control/pull/1908), so this feature might be added in the future).
So you have to use Kafka's `kafka-reassign-partitions.sh` tool in the second step and manually reassign all the partition replicas.
And using the tool and monitoring the progress is not exactly user-friendly.
And if you don't use `type: jbod` storage, you will be able to do this only completely manually by stopping the Strimzi Cluster Operator and manually changing the storage broker by broker.
That is even worse than using the `kafka-reassign-partitions.sh` utility.

So, can node pools help with this?

#### Storage in Kafka node pools

Each node pool has its own storage configuration.
That alone is a major improvement.
If you need to have different storage capacities or types for different Kafka nodes, you can simply use multiple node pools:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-a
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 500Gi
        class: fast
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-b
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 5Ti
        class: slow
  # ...
```

In the example above, `pool-a` uses fast and expensive storage of small capacity and `pool-b` uses a lot of slow and cheap storage.
But while this setup might be useful in some situations, it is not always practical.
Kafka lacks any advanced topic scheduling functionality.
So you cannot instruct it that one topic should be placed on nodes with slow storage while other topics should be placed on nodes with fast storage.
As a result, maintaining a setup like this might take a lot of effort.

However, you can use this to easily change the storage your brokers are using and easily solve the scenarios described earlier.
Shrinking the disks or changing the storage type can be done in a few simple steps.
Let's imagine that we have an old Apache Kafka cluster using Amazon Elastic Block Storage GP2 volumes and we want to migrate it to use the newer and more performant GP3 storage.
So we start with the following node pool:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: brokers
  labels:
    strimzi.io/cluster: my-cluster
spec:
  roles:
    - broker
  replicas: 3
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 1Ti
        class: gp2-ebs
  # ...
```

To migrate to the new storage, we have to first create a new node pool that uses the new storage type:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: brokers-gp3
  labels:
    strimzi.io/cluster: my-cluster
spec:
  roles:
    - broker
  replicas: 3
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 1Ti
        class: gp3-ebs
  # ...
```

Once the new brokers are deployed and ready, we can use Cruise Control and the `KafkaRebalance` resource to move everything from the old brokers to the new brokers:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaRebalance
metadata:
  name: my-rebalance
  labels:
    strimzi.io/cluster: my-cluster
  annotations:
    strimzi.io/rebalance-auto-approval: "true"
spec:
  mode: remove-brokers
  brokers: [0, 1, 2] # Use the node IDs of the existing brokers
  # ...
```

Now we have to wait until Cruise Control executes the rebalance for us.
The nice thing about this is that Cruise Control will do everything for us.
It will get all the topics on these brokers, figure out how they should be distributed on the new nodes, and finally move all the partition replicas.
Once the rebalance is complete, the old brokers will be empty and we can just delete the old node pool:

```
kubectl delete knp brokers
```

You can use the same steps to shrink storage as well.

### Pod scheduling

Scheduling Kafka pods to worker nodes in a Kubernetes cluster seems to be completely unrelated to storage.
But in some situations, they are closely related.
The persistent volumes have sometimes their own affinity.
For example, local persistent volumes can be used only within the worker node where they exist.
In some cases, the volumes might be available only in a particular availability zone or region.
This applies for example to Amazon AWS Elastic Block Storage.
In these situations, the storage you use affects to which Kubernetes worker can the Kafka pods be scheduled.

Strimzi of course allowed to configure pod scheduling already before node pools.
You can configure affinity, topology spread constraints, or tolerations in the `Kafka` custom resource.
But these rules always apply to all Kafka nodes.
So you could not easily configure that you want to have a Kafka cluster with 6 brokers out of which the nodes 0 and 1 should run in one availability zone and nodes 2, 3, 4, and 5 should run in a second zone.
Configurations like this can be especially useful if you don't have 3 availability zones/DCs and have to run your Apache Kafka cluster only in 2 or 2,5 zones/DCs.

One of the ways to work around this limitation is using storage affinity.
You can create two storage classes - each for one of your availability zones:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: sc-zone1
provisioner: kubernetes.io/my-storage
parameters:
  type: ssd
volumeBindingMode: WaitForFirstConsumer
allowedTopologies:
- matchLabelExpressions:
  - key: topology.kubernetes.io/zone
    values:
    - zone1
---

apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: sc-zone2
provisioner: kubernetes.io/my-storage
parameters:
  type: ssd
volumeBindingMode: WaitForFirstConsumer
allowedTopologies:
- matchLabelExpressions:
  - key: topology.kubernetes.io/zone
    values:
    - zone2
```

And then use them to provision the storage for the various Kafka nodes.
That can be configured using the storage overrides in the `Kafka` custom resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    replicas: 6
    storage:
      type: jbod
      volumes:
        - id: 0
          type: persistent-claim
          size: 1Ti
          deleteClaim: false
          overrides:
            - broker: 0
              class: sc-zone1
            - broker: 1
              class: sc-zone1
            - broker: 2
              class: sc-zone2
            - broker: 3
              class: sc-zone2
            - broker: 4
              class: sc-zone2
            - broker: 5
              class: sc-zone2
      # ...
  # ...
```

With the example above, the persistent volumes for brokers 0 and 1 will be provisioned using the storage class `sc-zone1` in the `zone1` availability zone.
The volumes for nodes 2, 3, 4, and 5 will be provisioned using storage class `sc-zone2` in the `zone2` availability zone.

Sure, it might be a bit _hacky_.
But it works.
However, with the node pools, this is not needed anymore.
Node pools allow you to configure affinity independently for each node pool.
So you can have only one storage class without any limitations in which zone it can be used:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: all-zones
provisioner: kubernetes.io/my-storage
parameters:
  type: ssd
volumeBindingMode: WaitForFirstConsumer
```

And we can configure the affinity in the node pools, in the `.spec.template.pod` section:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-zone1
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 2
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 1Ti
        class: all-zones
  template:
    pod:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                - key: topology.kubernetes.io/zone
                  operator: In
                  values:
                  - zone1
  # ...
---

apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: pool-zone2
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 4
  storage:
    type: jbod
    volumes:
      - id: 0
        type: persistent-claim
        size: 1Ti
        class: all-zones
  template:
    pod:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                - key: topology.kubernetes.io/zone
                  operator: In
                  values:
                  - zone2
  # ...
```

And as a result, Strimzi will deploy 2 brokers in the `zone1` availability zone and 4 in the `zone2`.
No special storage configuration is needed anymore.

### Conclusion

In this blog post, we covered a few other situations where node pools make your life easier.
If you think that some of them were niche issues that do not affect all users, you are probably right.
But don't worry, next week we will have a look at something important for everyone.
We will look at what role node pools play in Strimzi's support for KRaft / ZooKeeper-less Kafka.