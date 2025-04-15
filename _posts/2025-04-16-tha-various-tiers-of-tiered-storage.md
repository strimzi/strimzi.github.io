---
layout: post
title:  "The various tiers of Tiered Storage"
date: 2025-04-15
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
          # Tiered storage tunning
          chunk.size: "4194304" # 4 MiB
  # ...
```

And in all `KafkaNodePool` resources with the broker role, we have to mount the NFS volume in `.spec.template`.

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

TODO: Topic



TODO: Producer and consumer



TODO: Check NFS files



TODO: Read from tiered storage


### Conclusion

Hopefully, this blog post demonstrated that object storage is not the only option when it comes to tiered storage in Apache Kafka.
Depending on your infrastructure and on your requirements, shared file storage such as NFS is worth considering as well.
And thanks to that, even if you do not run in public cloud and don't have high-quality object storage available, you can still enjoy the immense benefits of using tiered storage in your Apache Kafka clusters.
