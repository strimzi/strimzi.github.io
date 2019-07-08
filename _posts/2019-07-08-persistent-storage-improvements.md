---
layout: post
title:  "Persistent storage improvements"
date: 2019-07-08
author: jakub_scholz
---

A few months ago I wrote [a blog post](https://strimzi.io/2019/02/28/resizing-persistent-volumes.html) about how you can manually increase the size of the persistent volumes you use for Kafka or Zookeeper storage.
I promised that one day it would be supported directly in Strimzi.
And that's what happened in the [Strimzi 0.12 release](https://github.com/strimzi/strimzi-kafka-operator/releases).
In this post I'm going to tell you more about the improvements to persistent storage in the 0.12 release.

<!--more-->

##  Resizing persistent volumes

Support for resizing volumes depends on the version of your Kubernetes or OpenShift cluster, and on the infrastructure it runs on.
We tested this feature with Kubernetes and OpenShift on Amazon AWS.
It should be compatible with Kubernetes 1.11+ and OpenShift 3.11+.
Resizing persistent volumes should work on most major public clouds (such as Amazon AWS, Microsoft Azure and Google Cloud) and many other storage types (such as Cinder or Ceph).

To tell your Kubernetes or OpenShift cluster that your storage supports volume resizing, you have to set the `allowVolumeExpansion` option in your StorageClass to `true`.
For example, the following `StorageClass` creates Amazon AWS GP2 volumes with `xfs` filesystem, encryption and volume expansion enabled:

```yaml
kind: StorageClass
apiVersion: storage.k8s.io/v1beta1
metadata:
  name: ssd
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp2
  encrypted: "true"
  fsType: "xfs"
reclaimPolicy: Delete
allowVolumeExpansion: true
```

The option is called `allowVolumeExpansion` because right now you can only increase the size of the volumes to expand them - you cannot decrease it.
Strimzi checks that the storage class has this option set to `true` before it tries to resize any volumes.
The [original blog post](https://strimzi.io/2019/02/28/resizing-persistent-volumes.html) explained in detail how this resizing works:

1. The size increase is requested by changing the `spec.resources.requests.storage` of the Persistent Volume Claim (PVC)
2. Kubernetes requests resizing of the volumes from your infrastructure
3. Once the resizing of the volume is finished, the pod using this volume needs to be restarted to allow the expansion of the file system

What Strimzi does is simplify this process by taking care of it for you! 
All you need to do is edit your Kafka custom resource and increase the requested storage size.
You can increase the size of both Zookeeper and Kafka volumes.
For example, you can change the resource from:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    storage:
      type: persistent-claim
      size: 100Gi
      deleteClaim: false
  zookeeper:
    # ...
    storage:
      type: persistent-claim
      size: 100Gi
      deleteClaim: false
```

to:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    storage:
      type: persistent-claim
      size: 1000Gi
      deleteClaim: false
  zookeeper:
    # ...
    storage:
      type: persistent-claim
      size: 200Gi
      deleteClaim: false
```

And the rest is taken care of by Strimzi.
The Cluster Operator automatically changes the requested volume size in the PVCs and waits until a restart of the pod is required.
Once the condition of the PVC is set to `FileSystemResizePending` (read the [original blog post](https://strimzi.io/2019/02/28/resizing-persistent-volumes.html) for more information about the different states the PVC can be in during the resizing), Strimzi automatically restarts the pod using this PVC.

```yaml
# ...
status:
  phase: Bound
  accessModes:
    - ReadWriteOnce
  capacity:
    storage: 1000Gi
  conditions:
    - type: FileSystemResizePending
      status: 'True'
      lastProbeTime: null
      lastTransitionTime: '2019-02-27T12:25:30Z'
      message: >-
        Waiting for user to (re-)start a pod to finish file system resize of
        volume on node.
```

The restart might not happen immediately - it will happen as part of the next periodical reconciliation.
So you might need to wait a couple of minutes before it happens.
The Cluster Operator is, of course, aware of your whole Kafka cluster and will not restart all your pods at the same time, but one by one to make sure your cluster remains in a usable state.

## Adding and removing volumes from JBOD storage

JBOD (Just a Bunch Of Disks) storage allows you to use multiple disks in each Kafka broker for storing commit logs.
Strimzi already added support for JBOD storage in Kafka brokers in version 0.11 (JBOD storage is not supported in Zookeeper).
But it didn't allow you to add or remove volumes from it.
You had to specify all your volumes when creating the cluster.

In 0.12 we significantly improved the JBOD storage support.
As well as resizing the volumes as described in the previous section, you can now add or remove volumes in an existing cluster.

To be able to do that, an existing Kafka cluster already needs to be using JBOD storage.
For example:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    storage:
      type: jbod
      volumes:
      - id: 0
        type: persistent-claim
        size: 1000Gi
        deleteClaim: false
      - id: 1
        type: persistent-claim
        size: 1000Gi
        deleteClaim: false
# ...
```

If you have something like this, you can easily add more volumes just by editing the YAML.
For example:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    storage:
      type: jbod
      volumes:
      - id: 0
        type: persistent-claim
        size: 1000Gi
        deleteClaim: false
      - id: 1
        type: persistent-claim
        size: 1000Gi
        deleteClaim: false
      - id: 10
        type: persistent-claim
        size: 1000Gi
        deleteClaim: false
      - id: 11
        type: persistent-claim
        size: 1000Gi
        deleteClaim: false
  # ...
```

Similarly you can also remove volumes:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    storage:
      type: jbod
      volumes:
      - id: 1
        type: persistent-claim
        size: 1000Gi
        deleteClaim: false
# ...
```

When removing volumes, Strimzi will not do anything to move the data from the volume you are removing.
You have to do that manually before removing the volume(s) from the JBOD storage.
Strimzi will simply remove the volume from the pods.

**There are some things you should keep in mind and take care with:**
* The `id` numbers have to be unique.
* The `id` numbers do not have to be in sequence.
* **Changing the `id` number is the same as removing the volume with the original `id`, and adding a new volume with the new `id`. 
Strimzi will stop using the old PVC with the old volume and create a new PVC for the new volume.**
* By default the PVCs are not deleted. 
So if you reuse an `id` which you already used in the past you should check first whether the old PVC still exists or not. 
If it exists, it will be reused instead of creating a new PVC with a new volume.

## Using different storage class for each broker

One of the other storage features we added in the 0.12 release is the capability to use a different storage class for each broker.
You can specify a different storage class for one or more Kafka brokers, instead of using the same storage class for all of them. 
This is useful if, for example, storage classes are restricted to different availability zones or data centers. You can use the `overrides` field for this purpose.
For example:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    storage:
      deleteClaim: true
      size: 100Gi
      type: persistent-claim
      class: my-storage-class
      overrides:
        - broker: 0
          class: my-storage-class-zone-1a
        - broker: 1
          class: my-storage-class-zone-1b
        - broker: 2
          class: my-storage-class-zone-1c
  # ...
```

## Conclusion

These improvements should make Strimzi more easy to use.
They should make it much easier to grow your Kafka cluster together with your project, which is important when you are looking to save on infrastructure costs.
Things such as adding volumes or resizing volumes are an important part of _Day 2 operations_ which is the area where the operator pattern can provide the most help.
In future Strimzi releases we plan to add more features related to storage - such as backup and recovery.

If you liked this blog post, star us on [GitHub](https://github.com/strimzi/strimzi-kafka-operator) and follow us on [Twitter](https://twitter.com/strimziio) to make sure you don't miss any of our future blog posts!
