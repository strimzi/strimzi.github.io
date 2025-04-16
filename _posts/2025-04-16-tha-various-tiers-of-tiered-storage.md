---
layout: post
title:  "The various tiers of Tiered Storage"
date: 2025-04-16
author: jakub_scholz
---

When it comes to tiered storage, most people will automatically connect it with object storage such as Amazon AWS S3.
And in case you are in one of the public clouds, using their objects storage is usually the most obvious choice.
But what if you run on premise?
There are multiple projects that allow you to deploy your own S3-compatible object storage.
But do you have time to manage the object storage deployment?
Will you be able to run it with the same durability and availability as AWS?
And will it have comparable performance?
That is, why you should maybe consider some other options as well.
And in this blog post we will look at one of them.

<!--more-->

### What is tiered storage

Tiered storage support in Apache Kafka was introduced in Kafka 3.6.0 as an early access feature.
And it is considered _production-ready_ from Kafka 3.9.0 (make sure to check out the current [Tiered storage limitations](https://kafka.apache.org/documentation/#tiered_storage_limitation)).
When enabled, Apache Kafka brokers use two types (tiers) of storage:
* The _local_ storage tier
* The _remote_ storage tier

The _local_ tier is the same storage Apache Kafka has been using since its beginnings.
It is typically based on block storage volumes.
While Apache Kafka documentation calls it _local_, the storage does not have to be physically located in the same machine where the Kafka broker using it is running.
It can be a block storage mounted over the network such as Amazon AWS EBS volumes, iSCSI volumes, etc.
The _remote_ tier the new tier introduced by the tiered storage.
It is typically based on some external storage such as the object storage we already mentioned on the beginning of this blog post.

Apache Kafka brokers always keep the latest data on the local storage tier.
But the older data will be offloaded to the remote tier.
How much data will be kept locally, how often will they be offloaded and so on ... that depends on how you configure the tiered storage.

#### What are the main benefits?

Using tiered storage has multiple benefits:
* The capacity local storage tier is ultimately limited by the maximum disk size.
  While can use JBOD storage to combine the capacity of multiple disks, there will be always some limit how many disks can be mounted on your server.
  With JBOD storage, you also need to take care of balancing the data between the different volumes.
  Compared to that, the capacity of something like Amazon AWS S3 storage is practically unlimited.
* By offloading the older data to the remote storage tier, the Kafka brokers will keep less data locally.
  That can help during various Kafka operations.
  For example, your brokers might a little bit start faster.
  This applies especially after some unclean shutdown.
  And if you loose the whole broker including its storage, its recovery will be much faster because it will need to replicate a lot less data from the other brokers.
* Scaling your Kafka cluster will become much easier because better separation between the storage and compute layers.
  When you want to add or remove brokers from your cluster, you will not need to move so many data between them as most of the data might be stored in the remote tier and are not affected at all when number of brokers in the cluster changes.

Tiered storage might also improve the running costs of your cluster, because in many situations, the remote storage tier will be significantly cheaper than the local storage tier.
But be careful, because this differ from use-case to use-case and from user-to-user.
The remote storage tier often use completely different pricing schemas.
For example, with Amazon AWS S3 we already mentioned before, your price is calculated based on the amount of data you store there, but also based on the number of API calls you make.
So while in most use-cases using object storage should be cheaper compared block storage, there might be some situations when the tiered storage is actually more expensive than the local storage tier.

The performance profile of the remote storage is usually also different from the block storage used for the local tier.
In particular the latency is often higher.
So accessing your older data that were offloaded to the remote tier might not be as fast as accessing the data kept locally.

Luckily, Apache Kafka allows us to configure the tiered storage on a per-topic basis.
So unlike other streaming platforms that rely only on the remote storage tier, you can decide when will tiered storage be used.
That way, you can keep the topics where low latency is critical or where repeated consumption would make the costs skyrocket as local only.

#### What makes a good remote storage?

The remote storage is used by all Kafka brokers from a given cluster.
The data stored in the remote tier are not assigned to any particular broker.
The data for given partition will be always written to the remote storage by the broker hosting the leader replica.
And they will be read by the brokers hosting the leader or follower replicas.
But when partition replicas are reassigned between the brokers, their data will remain unchanged in the remote storage tier.
So whatever type of storage you use as the remote tier, it has to be allow shared read and write access to all the data from all brokers.

Another important aspect when choosing the right remote storage is its performance, scalability, durability, and availability.
The actual requirements depend on your use-cases or on the type of environment where you use it.
But your Kafka cluster will be only as good as its weakest part.
So if you require high availability, durability, and performance, you have to make sure that your remote storage supports these requirements.

There are many technologies that might match these requirements.
Apart from the object storage, it can be for example HDFS storage or shared file storage.

NOTE: Apache Kafka uses plugins for the different implementations of the remote storage tier.
But no actual implementations are shipped as part of Apache Kafka itself.
So unless you want to write your own plugin, you have to also make sure that there is already some plugin implemented by someone else and has the required quality.

### Shared storage as a tiered storage

While running high-quality object storage on-premise might be challenging, shared file storage is often already available.
It might have for example the form of Network File System (NFS) volumes.
While the quality of it might differ between the users and their environments, it is in many cases already used by other applications and has the required availability and reliability.

NFS storage matches the requirements we listed in the previous section.
You can use it as a shared read-write-many volume between all your Kafka brokers.
And it can give you similar benefits as the object storage

Some of the tiered storage benefits can be even amplified when running Kafka on-premise.
For example when using local persistent volumes as the local storage tier, when you loose the physical server due to some hardware failure, you often loose its storage as well.
And tiered storage might make it significantly faster to fully recover your Kafka cluster.

Depending on the size of your Kafka cluster, one of the challenges with NFS storage might be its overall capacity and performance.
But that will be problem mainly for very large Kafka clusters with many brokers and large throughput.

In some cases, shared file storage might also be a viable alternative to consider even when running in public cloud.
Especially if the pricing schema used for the object storage is not a good fit for the way you use Apache Kafka, shared file storage is something you should include in your considerations.

So how do use NFS as a tiered storage with Strimzi?

#### Using shared tiered storage with Strimzi

We will not cover how to deploy and run NFS.
We will expect that you already have it available and that your Kubernetes cluster has a Storage Class named `nfs` available that can be used to provision NFS volumes.

First, we will need to add the tiered storage plugin to the Strimzi container image so that we can use it.
We will use the [Aiven Tiered Storage plugin](https://github.com/Aiven-Open/tiered-storage-for-apache-kafka) - in particular its filesystem part which can be used with NFS storage.
We will use the original Strimzi container image as the base image and add the plugin to it using a Dockerfile:

```Dockerfile
FROM quay.io/strimzi/kafka:0.45.0-kafka-3.9.0

USER root:root

#####
# Add Aiven Filesystem tiered storage plugin
#####
RUN mkdir $KAFKA_HOME/tiered-storage-filesystem
RUN curl -sL https://github.com/Aiven-Open/tiered-storage-for-apache-kafka/releases/download//core-0.0.1-SNAPSHOT.tgz | tar -xz  --strip-components=1 -C $KAFKA_HOME/tiered-storage-filesystem
RUN curl -sL https://github.com/Aiven-Open/tiered-storage-for-apache-kafka/releases/download//filesystem-0.0.1-SNAPSHOT.tgz | tar -xz  --strip-components=1 -C $KAFKA_HOME/tiered-storage-filesystem

USER 1001
```

We have to build the container image from the Dockerfile and push it into a container registry.
You can use your own container registry or one of the available services such as GitHub, Quay.io or Docker Hub.
If you do not have your own container registry or account in one of the services but still want to try tiered storage, you can use the ephemeral container registry [ttl.sh](https://ttl.sh/).
For example:

```
docker build -t quay.io/scholzj/kafka:0.45.0-tiered-storage-kafka-3.9.0 .
docker push docker push quay.io/scholzj/kafka:0.45.0-tiered-storage-kafka-3.9.0
```

Next, we need to prepare the shared volume that we will use as the remote storage tier.
We can do that by creating a new Persistent Volume Claim (PVC) that will use the `nfs` storage class to provision the NFS volume:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: tiered-storage-nfs
spec:
  accessModes:
    - ReadWriteMany
  volumeMode: Filesystem
  resources:
    requests:
      storage: 1Ti
  storageClassName: nfs
```

With the container image and volume ready, we can now deploy the Kafka cluster.
In the `Kafka` CR, we have to configure the container image with the tiered storage plugin in the `.spec.kafka.image` field.
And we have to also enable the tiered storage in `.spec.kafka.tieredStorage`.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  labels:
    app: my-cluster
  annotations:
    strimzi.io/node-pools: enabled
    strimzi.io/kraft: enabled
spec:
  kafka:
    # ...
    image: quay.io/scholzj/kafka:0.45.0-tiered-storage-kafka-3.9.0
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
    config:
      # Tiered storage tunning
      remote.log.manager.task.interval.ms: 5000
      # Delete segments ever 10 seconds
      log.retention.check.interval.ms: 10000
      # ...
    tieredStorage:
      type: custom
      remoteStorageManager:
        className: io.aiven.kafka.tieredstorage.RemoteStorageManager
        classPath: /opt/kafka/tiered-storage-filesystem/*
        config:
          storage.backend.class: io.aiven.kafka.tieredstorage.storage.filesystem.FileSystemStorage
          storage.root: /mnt/tiered-storage/
          storage.overwrite.enabled: "true"
          chunk.size: "4194304"
  # ...
```

And in all `KafkaNodePool` resources with the `broker` role, we have to mount the NFS volume in `.spec.template` using the additional volumes feature.
The `KafkaNodePool` resources that have only the `controller` role do not need the volume as the would not use tiered storage.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaNodePool
metadata:
  name: broker
  labels:
    strimzi.io/cluster: my-cluster
spec:
  roles:
    - broker
  # ...
  template:
    pod:
      volumes:
        - name: tiered-storage
          persistentVolumeClaim:
            claimName: tiered-storage-nfs
    kafkaContainer:
      volumeMounts:
        - name: tiered-storage
          mountPath: /mnt/tiered-storage/
```

Once the Kafka cluster is ready, we can to create a Kafka topic named `tiered-storage-test`.
Keep in mind that in order to use the tiered storage, you always have to enable in the topic as well:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: tiered-storage-test
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 10
  replicas: 3
  config:
    min.insync.replicas: 2
    retention.bytes: 107374182400 # ~100 Gi
    retention.ms: 604800000 # 7 days
    segment.bytes: 10485760 # ~10MB
    file.delete.delay.ms: 1000
    # Tiered storage configuration
    remote.storage.enable: true
    local.retention.ms: 60000 # 1 minute
    local.retention.bytes: 50000000 # 50 MB
```

To make it easier to see how the tiered storage works, the YAML above tunes some of the configuration options:
* Uses small segment size
* Keeps the local retention very short so that we can better see the log segments being offloaded to the remote storage tier

For a real life use of tiered storage, the values will be likely higher.
But the actual values might differ based on your use-case.
So make sure to tun them accordingly.

Finally, with the topic ready and with enabled tiered storage, we can start producing some messages.
To demonstrate the tiered storage functionality, we can use a Kubernetes Job to produce large amount of messages to out topic:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  labels:
    app: kafka-producer
  name: kafka-producer
spec:
  parallelism: 5
  completions: 5
  backoffLimit: 1
  template:
    metadata:
      name: kafka-producer
      labels:
        app: kafka-producer
    spec:
      restartPolicy: Never
      containers:
      - name: kafka-producer
        image: quay.io/strimzi/kafka:0.45.0-kafka-3.9.0
        command: [ "bin/kafka-producer-perf-test.sh" ]
        args: [ "--topic", "tiered-storage-test", "--throughput", "1000000000", "--num-records", "1000000000", "--producer-props", "acks=all", "bootstrap.servers=my-cluster-kafka-bootstrap:9092", "--record-size", "1000" ]
```

The Job above will start 5 parallel producers that will each send `1000000000` records with 1000 bytes each to our `tiered-storage-test` topic.
Once you deploy it, you can check the logs to monitor the progress:

```
...
31543 records sent, 6302.3 records/sec (6.01 MB/sec), 1953.5 ms avg latency, 4185.0 ms max latency.
31808 records sent, 6292.4 records/sec (6.00 MB/sec), 5002.5 ms avg latency, 6663.0 ms max latency.
38112 records sent, 7620.9 records/sec (7.27 MB/sec), 4633.1 ms avg latency, 6517.0 ms max latency.
43296 records sent, 8659.2 records/sec (8.26 MB/sec), 3936.9 ms avg latency, 5309.0 ms max latency.
...
```

Let it run for some time and then we will check how the storage in the Kafka cluster is used.
We can pick up one of the partitions of our topic and just list the files in the directory where the local storage tier stores its data.
This will be in `/var/lib/kafka/`.
For example:

```
$ kubectl exec -ti my-cluster-broker-0 -- ls -l /var/lib/kafka/data-0/kafka-log0/tiered-storage-test-0/
total 92312
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001314704.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001314704.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001314704.snapshot
-rw-r--r--. 1 1000740000 1000740000     1344 Apr 16 20:23 00000000000001314704.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001325056.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001325056.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001325056.snapshot
-rw-r--r--. 1 1000740000 1000740000     1296 Apr 16 20:23 00000000000001325056.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001335408.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001335408.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001335408.snapshot
-rw-r--r--. 1 1000740000 1000740000     1380 Apr 16 20:23 00000000000001335408.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001345760.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001345760.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001345760.snapshot
-rw-r--r--. 1 1000740000 1000740000     1248 Apr 16 20:23 00000000000001345760.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001356112.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001356112.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001356112.snapshot
-rw-r--r--. 1 1000740000 1000740000     1368 Apr 16 20:23 00000000000001356112.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001366464.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001366464.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001366464.snapshot
-rw-r--r--. 1 1000740000 1000740000     1440 Apr 16 20:23 00000000000001366464.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001376816.index
-rw-r--r--. 1 1000740000 1000740000 10484650 Apr 16 20:23 00000000000001376816.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001376816.snapshot
-rw-r--r--. 1 1000740000 1000740000     1260 Apr 16 20:23 00000000000001376816.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001387168.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001387168.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001387168.snapshot
-rw-r--r--. 1 1000740000 1000740000     1236 Apr 16 20:23 00000000000001387168.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:23 00000000000001397520.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:23 00000000000001397520.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:23 00000000000001397520.snapshot
-rw-r--r--. 1 1000740000 1000740000 10485756 Apr 16 20:23 00000000000001397520.timeindex
-rw-r--r--. 1 1000740000 1000740000        8 Apr 16 20:16 leader-epoch-checkpoint
-rw-r--r--. 1 1000740000 1000740000       43 Apr 16 20:16 partition.metadata
```

We can see that this partition has a bunch of segments here.
Thanks to the aggressive topic configuration, you can repeat the command just few minutes later and you should see that despite our topic having very long retention, the old segments are gone and new segments took their place:

```
$ kubectl exec -ti my-cluster-broker-0 -- ls -l /var/lib/kafka/data-0/kafka-log0/tiered-storage-test-0/
total 104448
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002277440.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002277440.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002277440.snapshot
-rw-r--r--. 1 1000740000 1000740000     1284 Apr 16 20:24 00000000000002277440.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002287792.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002287792.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002287792.snapshot
-rw-r--r--. 1 1000740000 1000740000     1344 Apr 16 20:24 00000000000002287792.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002298144.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002298144.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002298144.snapshot
-rw-r--r--. 1 1000740000 1000740000     1380 Apr 16 20:24 00000000000002298144.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002308496.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002308496.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002308496.snapshot
-rw-r--r--. 1 1000740000 1000740000     1128 Apr 16 20:24 00000000000002308496.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002318848.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002318848.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002318848.snapshot
-rw-r--r--. 1 1000740000 1000740000     1404 Apr 16 20:24 00000000000002318848.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002329200.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002329200.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002329200.snapshot
-rw-r--r--. 1 1000740000 1000740000     1284 Apr 16 20:24 00000000000002329200.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002339552.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002339552.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002339552.snapshot
-rw-r--r--. 1 1000740000 1000740000     1380 Apr 16 20:24 00000000000002339552.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002349904.index
-rw-r--r--. 1 1000740000 1000740000 10484650 Apr 16 20:24 00000000000002349904.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002349904.snapshot
-rw-r--r--. 1 1000740000 1000740000     1044 Apr 16 20:24 00000000000002349904.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002360256.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002360256.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002360256.snapshot
-rw-r--r--. 1 1000740000 1000740000     1068 Apr 16 20:24 00000000000002360256.timeindex
-rw-r--r--. 1 1000740000 1000740000     5168 Apr 16 20:24 00000000000002370608.index
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:24 00000000000002370608.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002370608.snapshot
-rw-r--r--. 1 1000740000 1000740000     1248 Apr 16 20:24 00000000000002370608.timeindex
-rw-r--r--. 1 1000740000 1000740000 10485760 Apr 16 20:24 00000000000002380960.index
-rw-r--r--. 1 1000740000 1000740000  1912190 Apr 16 20:24 00000000000002380960.log
-rw-r--r--. 1 1000740000 1000740000      240 Apr 16 20:24 00000000000002380960.snapshot
-rw-r--r--. 1 1000740000 1000740000 10485756 Apr 16 20:24 00000000000002380960.timeindex
-rw-r--r--. 1 1000740000 1000740000        8 Apr 16 20:16 leader-epoch-checkpoint
-rw-r--r--. 1 1000740000 1000740000       43 Apr 16 20:16 partition.metadata
```

So, where did the old segments go?
They were offloaded to the remote storage tier.
And because we use NFS, we can easily verify that with the `ls` command again.
Inside our NFS volume at the `/mnt/tiered-storage/` path, you will see a subdirectory for each topic that is using tiered storage.
And inside the topic subdirectory another subdirectory for each partition.
And inside that, you will find all the segments that were offloaded to the remote storage tier:

```
kubectl exec -ti my-cluster-broker-0 -- ls -l /mnt/tiered-storage/tiered-stroage-test-ZLI5GN1xR1aOqKnwKu5NOQ/0
total 5710364
-rw-r--r--. 1 1000740000 1000740000     6808 Apr 16 20:20 00000000000000000000-eKFr45f2Sca1O0kauyoFBw.indexes
-rw-r--r--. 1 1000740000 1000740000 10484635 Apr 16 20:20 00000000000000000000-eKFr45f2Sca1O0kauyoFBw.log
-rw-r--r--. 1 1000740000 1000740000      736 Apr 16 20:20 00000000000000000000-eKFr45f2Sca1O0kauyoFBw.rsm-manifest
-rw-r--r--. 1 1000740000 1000740000     6172 Apr 16 20:20 00000000000000010352-DmFiyQe8TpOzrpUjPF3rMQ.indexes
-rw-r--r--. 1 1000740000 1000740000 10484650 Apr 16 20:20 00000000000000010352-DmFiyQe8TpOzrpUjPF3rMQ.log
-rw-r--r--. 1 1000740000 1000740000      743 Apr 16 20:20 00000000000000010352-DmFiyQe8TpOzrpUjPF3rMQ.rsm-manifest
-rw-r--r--. 1 1000740000 1000740000     6520 Apr 16 20:20 00000000000000020704-WpjsPsRHTlivhNhxKOpGMA.indexes
-rw-r--r--. 1 1000740000 1000740000 10484680 Apr 16 20:20 00000000000000020704-WpjsPsRHTlivhNhxKOpGMA.log
-rw-r--r--. 1 1000740000 1000740000      744 Apr 16 20:20 00000000000000020704-WpjsPsRHTlivhNhxKOpGMA.rsm-manifest
...
```

Let's also try to consume the messages to make sure that the broker will correctly retrieve the data from the remote tier and deliver them to the consumer.
We can use the following command to show us the timestamp of the oldest messages in our topic:

```
$ kubectl run kafka-consumer -ti --image=quay.io/strimzi/kafka:0.45.0-kafka-3.9.0 --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic tiered-storage-test --from-beginning --max-messages 10 --property print.timestamp=true --property print.value=false
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
CreateTime:1744834829639
Processed a total of 10 messages
pod "kafka-consumer" deleted
```

When I convert the timestamp to regular time, I can see that it corresponds to `Wed Apr 16 2025 20:20:29`, which is the time when I deployed my producer and it is also the time when the oldest segment in the remote storage tier was created.
That way, we have confirmed that the data offloaded tot he remote storage tier are provided when the consumer requests them.

### Conclusion

Hopefully, this blog post demonstrated that object storage is not the only option when it comes to tiered storage in Apache Kafka.
Depending on your infrastructure and on your requirements, shared file storage such as NFS is worth considering as well.
And thanks to that, even if you do not run in public cloud and don't have high-quality object storage available, you can still enjoy the immense benefits of using tiered storage in your Apache Kafka clusters.
