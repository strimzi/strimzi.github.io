---
layout: post
title: "Kafka Tiered Storage Deep Dive"
date: 2024-02-08
author: federico_valeri_luke_chen
---

### Introduction

#### Tiering

The idea of tiering is not new in the software industry.
The three-tier architecture is a well-established software application architecture that organizes applications into three logical and physical computing tiers: the presentation tier, or user interface, the application tier, where data is processed, and the data tier, where data associated with the application is stored and managed.

> Layer is often used interchangeably with tier, but they aren't the same.
> A "layer" refers to a functional division of the software, but a "tier" refers to a functional division of the software that runs on separate infrastructure.
> For example, the contacts app on your phone is a three-layer application, but a single-tier application, because all three layers run on your phone.

Tiered storage refers to a storage architecture that uses different classes or tiers of storage to efficiently manage and store data based on its access patterns, performance requirements, and cost considerations.
This ensures that the most critical and frequently accessed data lives in high-performance "hot" storage (local), while less critical or infrequently accessed data is moved to lower-cost, lower-performance "warm" storage (remote).
We may also define "cold" storage as a periodic  backup system, but this is usually a separate process.

<figure>
    <img src="/assets/images/posts/2024-02-08-kafka-tiered-storage-deep-dive-fig1.png" height=300>
    <figcaption><small>Fig1: Tiers of storage.</small></figcaption>
</figure>

Unlike cache, tiered storage resides on one media type at any time, but moves between media as data access patterns change.
Data is not copied, but moved to a different storage medium, selecting the location that best balances availability, performance and the cost of the storage media.
This way, storage hardware can be better utilized, while still maximizing performance for mission-critical applications.
With tiered storage, some data may be cached, but only for performance reasons.

#### The need for remote storage

Apache Kafka is designed to ingest large volumes of data from thousands of clients.
A topic partition is made of multiple segment files, which are entirely hosted on a single disk of a Kafka broker, so there is always a limit in how much data you can store.

> Ideally, when provisioning a new Kafka cluster or topic, the retention policy should be set properly based on requirements and expected throughput (measured in MB/s).
> Inactive segments can be deleted based on specific retention policies, such as `segment.ms` or `segment.bytes`.
> If one record is not yet eligible for deletion based on retention.ms or retention.bytes, the broker retains the entire segment file.
> When the topic combines both time and size-based retention policies, the size-based policy defines the upper cap, and the time-based policy defines the expiration time.
> Deletion timing also depends on the cluster load and how many background.threads are available for normal topics, and log.cleaner.threads for compacted topics.
> The required storage capacity can be  estimated based on the calculation from message write rate and the retention policy.
>
>```sh
> # time-based retention
> storage_capacity (MB) = retention_sec * topic_write_rate (MB/s) * replication_factor
>
> # size-based retention
> storage_capacity (MB) = retention_mb * replication_factor
> ```

What if I want to keep historical data?
This is where the need for remote storage arises. Historical data of regular topics need to be stored somewhere in a format ready for post-processing.
For example, we may need them for disaster recovery, or to initialize a new application, or to rebuild the application state after fixing an issue with the business logic.
Another popular use case is Machine Learning, where batch ingestion may be used for model training.

There are basically two approaches for keeping historical data outside Kafka:

1. Use an additional process to read all ingested data out of Kafka and copy them to a remote storage.
   Sometimes this is done using Kafka Connect, with a configuration-driven approach.
   This comes with the drawback of data consumers having to build different versions of applications to consume the data from different systems depending on the age of the data.
2. Use a custom program running on the Kafka machine, which checks when the raw segments are closed and copies them to an external storage.
   The advantage of this solution is that there is no cost in feeding back to Kafka for reprocessing, but it is another program you have to maintain.

#### Tiered storage in Kafka

The custom program solution is similar to the new Kafka Tiered Storage feature ([KIP-405](https://cwiki.apache.org/confluence/display/KAFKA/KIP-405%3A+Kafka+Tiered+Storage)) released as early access in Kafka 3.6.0.
This new feature offers a standardized built-in mechanism for automatically moving closed segments from local storage (i.e. SSD/NVMe) to remote storage (i.e. S3/HDFS) when the retention kicks in, and reading back data from remote storage when a client asks for them.
Various external storage systems can be supported via external plugins, which are not part of the Kafka project.

Kafka Tiered Storage must be enabled at the cluster level with `remote.log.storage.system.enable` and at topic level with `remote.storage.enable`.
There are two retention periods that can be configured at the topic level: `local.log.retention.ms` for local storage, that can be reduced to days or even hours, and `log.retention.ms` for remote storage, which can be days, weeks or even months.
If needed, you can also configure retention by size, or both.
The Kafka broker moves data to the remote storage as soon as possible, but certain conditions, such as high ingestion rate or connectivity issues, may cause more data to be stored in the local storage than the specified local retention policy.
Any data exceeding the local retention threshold will not be purged by the until successfully uploaded to remote storage.

Only the leader's log segment is uploaded to the remote storage, not followers.
It is important to verify the remote storage durability guarantee.
When consumers fetch records from remote storage, the broker caches index files locally, so it is recommended to reserve disk space for that (1GiB by default, which is configurable in `remote.log.index.file.cache.total.size.bytes`).

There are various benefits that come with Kafka Tiered Storage: 

- **Elasticity**: The separation of compute and storage resources that can now be scaled independently, and cluster maintenance becomes faster due to less local data. 
- **Isolation**: There are no changes to the Kafka clients. Latency sensitive applications can be served from the local tier as usual, while batch or recovering applications can be served from the remote tier using a different code path and threads. 
- **Cost efficiency**: Kafka storage becomes cheaper and virtually unlimited. Remote object storage systems are less expensive than fast local disks.

There are also some limitations, that will be addressed in future releases:

- No support for multiple log directories (JBOD) and compacted topics (this includes compacted topics converted to regular topics).
- Once enabled on a topic, the only way to disable tiering is to delete the entire topic, losing data.

There are several [metrics for remote storage operations](https://kafka.apache.org/documentation/#tiered_storage_monitoring) that you can use to monitor and create alerts about degradation of the remote storage service (e.g. Slow Remote Upload/Download Rate, High Remote Upload/Download Error Rate, Busy Upload/Download Thread Pool).

An important feature, which is still under development, is the possibility to dynamically set broker level quotas to limit the rate at which we are uploading and downloading segments ([KIP-956](https://cwiki.apache.org/confluence/display/KAFKA/KIP-956+Tiered+Storage+Quotas)).
This is useful to avoid CPU over utilization, and remote storage degradation.
For example, this can happen when you enable tiered storage for the first time on existing topics.

### Kafka internals

#### How messages are stored

Taking a step back, let's first see how messages are stored on disk.
In Kafka, we have two main subsystems, the data plane, which is made of components dealing with user data (messages, aka records), and the control plane, which is made of components dealing with cluster metadata (Controller election, topic configuration and clustering).

<figure>
    <img src="/assets/images/posts/2024-02-08-kafka-tiered-storage-deep-dive-fig2.png" height=200>
    <figcaption><small>Fig2: Data and control planes.</small></figcaption>
</figure>

> When a new batch of messages arrives, it is firstly written into the Operating System's page cache, and then flushed to disk asynchronously.
> If the Kafka JVM crashes for whatever reason, recent messages are still in the page cache, and can be flushed by the Operating System.
> However, this doesn't protect from data loss when the machine crashes, and this is why enabling topic replication is important.
> To further improve fault tolerance, a rack-aware Kafka cluster can be used to distribute topic replicas evenly across data centers in the same geographic region.

The Kafka producer has a configurable Partitioner that assigns the message to a specific topic partition based on the key hash, when provided, the default partitioner is using Strictly Uniform Sticky Partitioner ([KIP-794](https://cwiki.apache.org/confluence/display/KAFKA/KIP-794%3A+Strictly+Uniform+Sticky+Partitioner)).
This message is not sent immediately, but accumulated and sent in a batch based on time or size configuration properties.
The ProduceRequest is received by the broker’s SocketReceiveBuffer and picked up by a NetworkThread, which is assigned to that particular client connection.
The NetworkThread reads data from the SocketReceiveBuffer, converts that request into a ProduceRequest object and sends it over to the RequestQueue.
An IOThread picks up the ProduceRequest from the queue and performs validations, before appending the data to the partition’s segment (log and index files).

<figure>
    <img src="/assets/images/posts/2024-02-08-kafka-tiered-storage-deep-dive-fig3.png" height=400>
    <figcaption><small>Fig3: Data plane message flow.</small></figcaption>
</figure>

The broker does not acknowledge a produce request until it has been replicated across other brokers.
A map-like data structure called Purgatory is used to park that request while waiting for replication to complete. This avoids exhausting all IOThreads that are just waiting for the network.
Once the replication step is completed, the broker will take out the request object from Purgatory and generate a ProduceResponse object to place it into the ResponseQueue.
Finally, the NetworkThread handling that request picks up the response object from the ResponseQueue and puts its data into the SocketSendBuffer.

Similarly, the Kafka consumer sends a FetchRequest specifying the desired topic, partition and offset to consume from.
This request is sent to the broker’s SocketReceiveBuffer and a NetworkThread forwards it to the RequestQueue.
An IOThread extracts the provided offset and compares it with the corresponding entry in the index file, which is part of the partition segment.
This step determines the exact number of bytes to be read from the log file and added to the response object.
As an optimization, the broker waits for a minimum number of bytes, or for a specified maximum time before returning the response.
During this time, the request is parked in the Purgatory.

#### Remote log subsystem

In order to append data to the log, the IOThread talks to the ReplicaManager, which is where the remote log subsystem is plugged in.
The main components are the RemoteLogManager (RLM), the RemoteStorageManager (RSM), and the RemoteLogMetadataManager (RLMM).
It is possible to configure specific implementations of the storage and metadata managers interfaces.

<figure>
    <img src="/assets/images/posts/2024-02-08-kafka-tiered-storage-deep-dive-fig4.png" height=450>
    <figcaption><small>Fig4: Remote log subsystem high level architecture.</small></figcaption>
</figure>

The RemoteLogSegmentMetadata describes a log segment uploaded to the remote storage.
It contains a universally unique RemoteLogSegmentId composed by topic name, topic id, partition number, and remote segment uuid (two copies of the same segment have different remote segment ids), other segment information (offsets, size, leader epochs), and segment state.
The LogSegmentData represents all required data and indexes for a specific log segment that needs to be stored in the remote storage.

```sh
# this is how a remote segment with all indexes and auxiliary state looks like on remote storage
-rw-r--r--. 1 fvaleri fvaleri    8 Feb  6 12:18 0.ba5f4403-d68c-44cd-b35a-319cb88b4318.LEADER_EPOCH
-rw-r--r--. 1 fvaleri fvaleri  504 Feb  6 12:18 0.ba5f4403-d68c-44cd-b35a-319cb88b4318.OFFSET
-rw-r--r--. 1 fvaleri fvaleri  194 Feb  6 12:18 0.ba5f4403-d68c-44cd-b35a-319cb88b4318.PRODUCER_SNAPSHOT
-rw-r--r--. 1 fvaleri fvaleri 973K Feb  6 12:18 0.ba5f4403-d68c-44cd-b35a-319cb88b4318.segment
-rw-r--r--. 1 fvaleri fvaleri  456 Feb  6 12:18 0.ba5f4403-d68c-44cd-b35a-319cb88b4318.TIMESTAMP
```

The RemoteLogManager is the central component that maintains a list of managed topic-partitions updated by ReplicaManager events.
It is responsible for initializing the RemoteStorageManager and RemoteLogMetadataManager, handling events about leader/follower changes and partition stops, providing APIs to fetch indexes and metadata about remote log segments, copying log segments to the remote storage, cleaning up segments that are expired based on retention size or retention time.

The RemoteLogMetadataManager is used to store metadata about uploaded segments, and requires a strongly consistent storage.
This is pluggable, but Kafka provides a default implementation called TopicBasedRemoteLogMetadataManager that uses an internal non compacted topic called __remote_log_metadata to store metadata records.

There are 4 record types, that are defined in storage/src/main/resources/message: 

- RemoteLogSegmentMetadataRecord
- RemoteLogSegmentMetadataSnapshotRecord
- RemoteLogSegmentMetadataUpdateRecord
- RemotePartitionDeleteMetadataRecord

<figure>
    <img src="/assets/images/posts/2024-02-08-kafka-tiered-storage-deep-dive-fig5.png" height=500>
    <figcaption><small>Fig5: Sequence diagram for segment copy.</small></figcaption>
</figure>

The RemoteLogManager schedules a periodic RLMTask for each managed topic-partition using the RLMScheduledThreadPool.
A thread of this pool processes one topic-partition at a time.
If there are multiple log segments that are rolled (inactive) and have the LastOffset < LastStableOffset (the offset of the last committed message), they are copied one by one to the remote storage, from the earliest to latest.

There are caches that are used for performance reasons.
A file-based RemoteIndexCache is maintained by the RemoteLogManager and stored in the remote-log-index-cache folder.
An in-memory RemoteLogMetadataCache maintained by the TopicBasedRemoteLogMetadataManager.

<figure>
    <img src="/assets/images/posts/2024-02-08-kafka-tiered-storage-deep-dive-fig6.png" height=400>
    <figcaption><small>Fig6: Sequence diagram for consumer Fetch request.</small></figcaption>
</figure>

The consumer Fetch request changes on a tiered topic.
When handling the request, the ReplicaManager gets an OffsetOutOfRangeException if the required offset has moved to the remote storage.
At this point, the ReplicaManager adds the request into the RemoteFetchPurgatory, and delegates to the RemoteLogManager, by submitting a RemoteLogReader to the RemoteStorageThreadPool's queue.
Each RemoteLogReader processes one remote Fetch request at a time.

The Follower replication also changes on a tiered topic.
When the follower partition replica gets OffsetMovedToTieredStorageException while fetching from from the leader, it means that the fetch offset is no longer available in the leader's local storage, and the follower needs to build the auxiliary state from remote segment metadata.
The partition's auxiliary state includes the leader-epoch checkpoint, which is used by the log replication protocol to maintain log consistency across brokers, and the producer-id snapshot, which is used by the transaction subsystem.
The follower invokes the ListsOffsets API with EarliestLocalTimestamp parameter to know up to which offset it needs to rebuild this state.
After the auxiliary state is built, the follower resumes fetching from the leader's local storage.

### Conclusion

We've delved into the necessity for remote storage in Kafka, particularly for retaining historical data critical for various use cases like disaster recovery, application initialization, and machine learning.
The introduction of Kafka Tiered Storage presents a standardized, built-in solution.

By leveraging different storage tiers based on data access patterns, performance needs, and cost considerations, tiered storage optimizes resource utilization while ensuring efficient data management.

We've also provided insight into the technical architecture underpinning the remote log subsystem, elucidating the roles of components like the RemoteLogManager, RemoteStorageManager, and RemoteLogMetadataManager.

Tiered storage represents a significant advancement in data management within Kafka ecosystems, offering a robust solution for efficient data storage and retrieval in modern distributed architectures.
