---
layout: post
title:  "Optimizing Kafka brokers"
date: 2021-06-01
author: paul_mellor
---

Following our popular and evergreen posts on fine-tuning [producers](https://strimzi.io/blog/2020/10/15/producer-tuning/) and [consumers](https://strimzi.io/blog/2021/01/07/consumer-tuning/),
we complete our _Kafka optimization trilogy_ with this post on getting started with broker configuration.

In terms of the options you can use to configure your brokers, there are countless permutations.
We've reduced and refined the options and present here what's typically configured to get the most out of Kafka brokers.

And when we say brokers, we also include topics.
Broker configuration often corresponds with configuration options at the topic level, such as setting the maximum batch size for topics with `message.max.bytes`.
In this way, you might want to consider topic-level configuration first and have your broker-level settings operating as defaults if the topic-level configuration isn't set explicitly.

<!--more-->

### Basic broker configuration

A basic broker configuration might look something like this.
You'll see settings for topics, threads and logs.

```properties
# ...
num.partitions=1
default.replication.factor=3
offsets.topic.replication.factor=3
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=1
log.retention.hours=168
log.segment.bytes=1073741824
log.retention.check.interval.ms=300000
num.network.threads=3
num.io.threads=8
num.recovery.threads.per.data.dir=1
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600
group.initial.rebalance.delay.ms=0
zookeeper.connection.timeout.ms=6000
# ...
```

In Strimzi, you configure these settings through the `config` property of the `Kafka` custom resource.
In this post, we suggest what else you might add to optimize your Kafka brokers.

> Some properties are [managed directly by Strimzi](https://strimzi.io/docs/operators/latest/using.html#property-kafka-config-reference), such as `broker.id`. These properties are ignored if they are added to the `config` specification.

### Replicating topics for high availability

When you configure topics, the number of partitions, minimum number of in-sync replicas and partition replication factor are typically set at the topic level.
You can use [Strimzi's `KafkaTopic`](https://strimzi.io/docs/operators/latest/using.html#proc-configuring-kafka-topic-str) to do this.
You can also set these properties at the broker level too. In which case, the defaults are applied to topics that do not have these properties set explicitly, including automatically-created topics.

```properties
# ...
num.partitions=1
default.replication.factor=3
min.insync.replicas=2
# ...
```

High availability environments require a replication factor of at least 3 for topics and a minimum number of in-sync replicas as 1 less than the replication factor.
For increased data durability, set `min.insync.replicas` in your *topic* configuration and message delivery acknowledgments using `acks=all` in your *producer* configuration.

Use the `replica.fetch.max.bytes` property to set a maximum size for the messages fetched by each _follower_ that replicates the data from a _leader_ partition.
Base the value on the average message size and throughput. When considering the total memory allocation required for read/write buffering, the memory available must also be able to accommodate the maximum replicated message size when multiplied by all followers. The size must also be greater than `message.max.bytes` so that all messages can be replicated.

```properties
# ...
replica.fetch.max.bytes=1048576
# ...
```

The importance of Kafka's topic replication mechanism cannot be overstated.
Topic replication is central to Kafka's reliability and data durability. Using replication, a failed broker can recover from its in-sync replicas.
We go into more detail about leaders, followers and in-sync replicas with [partition rebalancing for availability](#partition-rebalancing-for-availability).

The `auto.create.topics.enable` property to create topics automatically is usually disabled. Kafka users tend to prefer applying more control over topic creation.
If you do use automatic topic creation, set `num.partitions` to equal the number of brokers in the cluster so that writes are distributed.
The `delete.topic.enable` property to allow topics to be deleted is usually disabled too. This time you're making sure that data is not accidentally lost, although you can temporarily enable the property to delete topics if circumstances demand it.

```properties
# ...
auto.create.topics.enable=false
delete.topic.enable=true
# ...
```

> You can delete topics with the `KafkaTopic` resource if the `delete.topic.enable` property is enabled.

### Internal topic settings for transactions and commits

Pay attention to the configuration requirements for internal Kafka topics.

If you are [using transactions](https://strimzi.io/docs/operators/latest/using.html#reliability_guarantees) to guarantee the reliability of writes to partitions from producers, the internal `__transaction_state` topic used in the process requires a minimum of three brokers with the default settings.

```properties
# ...
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=2
# ...
```

The `__consumer_offsets` topic, which stores partition offset commits, has default settings for the number of partitions and replication factor.

```properties
# ...
offsets.topic.num.partitions=50
offsets.topic.replication.factor=3
offsets.commit.required.acks=-1
# ...
```

***:warning: Do not reduce these settings in production.***

### Improving request handling throughput by increasing I/O threads

Network threads (`num.network.threads`) handle requests to the Kafka cluster, such as produce and fetch requests from client applications.
Adjust the number of network threads to reflect the replication factor and the levels of activity from client producers and consumers interacting with the Kafka cluster.

I/O threads (`num.io.threads`) pick up requests from the request queue to process them. Adding more threads can improve throughput, but the number of CPU cores/and disk bandwidth imposes a practical upper limit.
The minimum number of threads should equal the number of storage volumes.

To reduce congestion and regulate the request traffic, you can use `queued.max.requests` to limit the number of requests allowed in the request queue before the network thread is blocked.
Use `num.recovery.threads.per.data.dir` to specify the number of threads used for log loading at startup and flushing at shutdown.

```properties
# ...
num.io.threads=8
queued.max.requests=500
num.network.threads=3
num.recovery.threads.per.data.dir=1
# ...
```

> Kafka broker metrics can help with working out the number of threads required. For example, metrics for the average time network threads are idle (`kafka.network:type=SocketServer,name=NetworkProcessorAvgIdlePercent`) indicate the percentage of resources used.
If there is 0% idle time, all resources are in use, which means that more threads would be beneficial.

If threads are slow or limited due to the number of disks, try increasing the size of the buffers for network requests to improve throughput:

```properties
# ...
replica.socket.receive.buffer.bytes=65536
# ...
```

And also increase the maximum number of bytes Kafka can receive:

```properties
# ...
socket.request.max.bytes=104857600
# ...
```

### Increasing bandwidth for high latency connections

If you've fine-tuned the size of your message batches, but latency is impeding the performance of your Kafka environment, try increasing the size of the buffers for sending and receiving messages.

```properties
# ...
socket.send.buffer.bytes=1048576
socket.receive.buffer.bytes=1048576
# ...
```

You can work out the optimal size of your buffers using a _bandwidth-delay_ product calculation.
You need some figures to work with. Essentially, you want to multiply your bandwidth capacity with the round-trip delay to give the data volume.
Go look at this [wiki definition](https://en.wikipedia.org/wiki/Bandwidth-delay_product) to see examples of the calculation.

### Managing logs with data retention policies

Kafka uses logs to store message data. Logs are a series of segments. New messages are written to a single _active_ segment. The messages are never modified.  
Using fetch requests, consumers read from the active segment. After a time, the active segment is _rolled_ to become ready-only as a new active segment replaces it.
Older segments are retained until they are eligible for deletion.

You can configure the maximum size in bytes of a log segment and the amount of time in milliseconds before an active segment is rolled.
Set them at the topic level using `segment.bytes` and `segment.ms`. Or set defaults at the broker level for any topics that do not have these settings:

```properties
# ...
log.segment.bytes=1073741824
log.roll.ms=604800000
# ...
```

Larger sizes means the active segment contains more messages and is rolled less often.
Non-active segments also become eligible for deletion less often.

You can set time-based or size-based log retention policies, in conjunction with the cleanup policies we cover next, so that logs are kept manageable.
Non-active log segments are removed when retention limits are reached.
By controlling the size of the log you retain, you can make sure that you're not likely to exceed disk capacity.

For time-based log retention, use the milliseconds configuration, which has priority over the related minutes and hours configuration.
The milliseconds configuration also updates dynamically.

```properties
# ...
log.retention.ms=1680000
# ...
```

The retention period is based on the time messages were appended to the segment.
If  `log.retention.ms` is set to -1, no time limit is applied to log retention, so all logs are retained.  
Disk usage should always be monitored, but the -1 setting is not generally recommended as it can lead to issues with full disks, which can be hard to rectify.

For size-based log retention, set a maximum log size in bytes:

```properties
# ...
log.retention.bytes=1073741824
# ...
```

The maximum log size is for all segments in the log.
When the maximum log size is reached, older segments are removed.

Setting a maximum log size does not consider the time messages were appended to a segment.
If that's a potential issue, you can use time-based and size-based retention. When you use both, the first threshold reached triggers the cleanup.

### Removing log data with cleanup policies

Kafka's log cleaner does what you expect.
It removes old data from the log.
Enabled by default (`log.cleaner.enable=true`), you can put some control on how the cleaner operates by defining a _cleanup policy_.

```properties
# ...
log.cleanup.policy=compact,delete
# ...
```

* **Delete policy**
`delete` policy corresponds to managing logs with data retention policies. It's suitable when data does not need to be retained forever. Older segments are deleted based on log retention limits. Otherwise, if the log cleaner is not enabled, and there are no log retention limits, the log will continue to grow.

* **Compact policy**
`compact` policy guarantees to keep the most recent message for each message key. Log compaction is suitable when message values are changeable, and you want to retain the latest update. New messages are appended to the  _head_ of the log, which acts in the same way as a non-compacted log with writes appended in order. The _tail_ of a compacted log has the older messages that are deleted or compacted according to policy. Consequently, the tail has non-contiguous offsets.

**Log showing key value writes with offset positions before compaction**

![Image of compaction showing key value writes](/assets/images/posts/2021-05-06-broker-tuning-compaction-1.png)

If you're not using keys, you can't use compaction as keys are needed to identify related messages. The latest message (with the highest offset) is kept and older messages with the same key are discarded. You can restore a message back to a previous state. Records retain their original offsets after cleanup. When consuming an offset that's no longer available in the tail, the record with the next higher offset is found.

After the log has been cleaned up, compacted messages are no longer available in the tail of the log. Records retain their original offset. Consuming from the offset of record that is no longer available returns the next higher available offset.

**Log after compaction**

![Image of compaction after log cleanup](/assets/images/posts/2021-05-06-broker-tuning-compaction-2.png)

Logs can still become arbitrarily large using compaction alone. You can control this by setting policy to compact _and_ delete logs.
Log data is first compacted, removing older records that have a key in the head of the log. Then data that falls before the log retention threshold is deleted.

**Log retention point and compaction point**

![Image of compaction with retention point](/assets/images/posts/2021-05-06-broker-tuning-compaction-3.png)

Adjust the frequency the log is checked for cleanup in milliseconds using `log.retention.check.interval.ms`. Base the frequency on log retention settings. Cleanup should be often enough to manage the disk space, but not so often it affects performance on a topic. Smaller retention sizes might require more frequent checks. You can put the cleaner on standby if there are no logs to clean for a set period using `log.cleaner.backoff.ms`.

When deleting all messages related to a specific key, a producer sends a _tombstone_ message, which has a null value and acts as a marker to tell a consumer the value is deleted. After compaction, only the tombstone is retained, which must be for a long enough period for the consumer to know that the message is deleted. Use `log.cleaner.delete.retention.ms` to make sure that consumers have the chance to read the final state of a deleted record before it is permanently deleted. When older messages are deleted, having no value, the tombstone key is also deleted from the partition.

```properties
# ...
log.retention.check.interval.ms=300000
log.cleaner.backoff.ms=15000
log.cleaner.delete.retention.ms=86400000
# ...
```

### Managing disk utilization

There are many other configuration settings related to log cleanup, but of particular importance is memory allocation.

The deduplication property specifies the total memory for cleanup across all log cleaner threads.
You can set an upper limit on the percentage of memory used through the buffer load factor.

```properties
# ...
log.cleaner.dedupe.buffer.size=134217728
log.cleaner.io.buffer.load.factor=0.9
# ...
```

Each log entry uses exactly 24 bytes, so you can work out how many log entries the buffer can handle in a single run and adjust the setting accordingly.

If possible, consider increasing the number of log cleaner threads if you are looking to reduce the log cleaning time:

```properties
# ...
log.cleaner.threads=8
# ...
```

If you are experiencing issues with 100% disk bandwidth usage, you can throttle the log cleaner I/O so that the sum of the read/write operations is less than a specified double value based on the capabilities of the disks performing the operations:

```properties
# ...
log.cleaner.io.max.bytes.per.second= 1.7976931348623157E308
# ...
```

### Handling large message sizes

Calibrated for optimal throughput in most situations, Kafka's default message batch size is set to 1MB. If you have the [disk capacity](#managing-disk-utilization), you can increase the batch size at a reduced throughput.  

You have four ways to handle large message sizes:

- Producer-side message compression
- Reference-based messaging
- Inline messaging
- Broker and producer/consumer configuration

We recommend trying producer-side message compression or reference-based messaging, which cover most situations.

#### Producer-side compression
For producer-side compression, you specify a `compression.type`, such as Gzip, to apply to batches. In the broker configuration, you use `compression.type=producer` so that the broker retains whatever compression the producer used. It's better that the producer and topic compression types match. Otherwise, the broker has to compress the batches again before appending them to the log.

Compressing batches will add additional processing overhead on the producer and decompression overhead on the consumer. But you will get more data in a batch, which helps with throughput. Examine your metrics and combine producer-side compression with fine-tuning of the batch size to get the best outcome.

#### Reference-based messaging
Reference-based messaging only sends a reference to data stored in some other system in the message’s value. This is useful for data replication when you do not know how big a message will be.
Data is written to the data store, which must be fast, durable, and highly available, and a reference to the data is returned. The producer sends the reference to Kafka. The consumer uses the reference to fetch the data from the data store.

**Reference-based messaging flow**

![Image of reference-based messaging flow](/assets/images/posts/2021-05-06-broker-tuning-reference-messaging.png)

Referenced-based messaging means more for message passing requires more trips, so end-to-end latency will increase. One major drawback of this approach is that there is no automatic clean up of the data in the external system when the Kafka message is cleaned up.

One way to mitigate the limitations of reference-based messaging is to take a hybrid approach. Send large messages to the data store and process standard-sized messages directly.

#### Inline messaging
Inline messaging is a complex process that splits messages into chunks that use the same key, which are then combined on output using a stream processor like Kafka Streams.

The basic steps are:

- The client application serializes then chunks the data if the message is too big.
- The producer uses the Kafka `ByteArraySerializer` or similar to serialize each chunk again before sending it.
- The consumer receives the chunks, which are assembled before deserialization.
- The consumer tracks messages and buffers chunks until it has a complete message.
- Complete messages are delivered in order according to the offset of the first or last chunk for each set of chunked messages.
- Successful delivery of the complete message is checked against offset metadata to avoid duplicates during a rebalance.

**Inline messaging flow**

![Image of inline messaging flow](/assets/images/posts/2021-05-06-broker-tuning-inline-messaging.png)

Inline messaging does not depend on external systems like reference-based messaging. But it does have a performance overhead on the consumer side because of the buffering required, particularly when handling a series of large messages in parallel. The chunks of large messages can become interleaved, so that it is not always possible to commit when all the chunks of a message have been consumed if the chunks of another large message in the buffer are incomplete. For this reason, buffering is usually supported by persisting message chunks or by implementing commit logic.

#### Configuration to handle larger messages**

You increase message limits by configuring `message.max.bytes` to set the maximum record batch size. You can set the limit at the topic level or the broker level. If you set limit at the broker level, larger messages are allowed for all topics and messages greater than the maximum limit are rejected. The buffer size for the producers (`max.request.size`) and consumers (`message.max.bytes`) must be able to accommodate the larger messages.

### Controlling the log flush of message data

Usually, log flush thresholds are not usually set and the operating system performs a background flush using its default settings. But if you are using application flush management, setting lower flush thresholds might be appropriate if you are looking at ways to decrease latency or you are using faster disks.

Use the log flush properties to control the periodic writes of cached message data to disk. You can specify the frequency of checks on the log cache in milliseconds. Control the frequency of the flush based on the maximum amount of time that a message is kept in-memory and the maximum number of messages in the log before writing to disk.

```properties
# ...
log.flush.scheduler.interval.ms=2000
log.flush.interval.ms=50000
log.flush.interval.messages=100000
# ...
```

The wait between flushes includes the time to make the check and the specified interval before the flush is carried out. Increasing the frequency of flushes can affect throughput.

### Partition rebalancing for availability

When replicating data across brokers, a partition leader on one broker handles all producer requests (writes to the log). Partition followers on other brokers replicate the partition data of the leader. So you get data reliability in the event of the leader failing. Followers need to be in sync for recovery, meaning the follower has caught up with the most recently committed message on the leader. If a leader is no longer available, one of the in-sync replicas is chosen as the new leader. The leader checks the follower by looking at the last offset requested.

>An out-of-sync follower is usually not eligible as a leader should the current leader fail, unless [unclean leader election is allowed](#unclean-leader-election).

You can adjust the lag time before a follower is considered out of sync:

```properties
# ...
replica.lag.time.max.ms
# ...
```

This is the time to replicate a message to all in-sync replicas and return an acknowledgment to a producer. If a follower fails to make a fetch request and catch up with the latest message within the specified lag time, it is removed from in-sync replicas. The time you use depends on both network latency and broker disk bandwidth. You can reduce the lag time to detect failed replicas sooner, but by doing so you might increase the number of followers that fall out of sync needlessly.

>Followers operate only to replicate messages from the partition leader and allow recovery should the leader fail. Followers do not normally serve clients, though [rack configuration](https://strimzi.io/docs/operators/latest/using.html#type-Rack-reference) allows a consumer to consume messages from the closest replica when a Kafka cluster spans multiple datacenters.

A failed leader affects the balance of a Kafka cluster, as does the assignment of partition replicas to brokers. Rebalancing ensures that leaders are evenly distributed across brokers and brokers are not overloaded. You can control the frequency, in seconds, of rebalance checks and the maximum percentage of imbalance allowed for a broker before a rebalance is triggered.

```properties
#...
auto.leader.rebalance.enable=true
leader.imbalance.check.interval.seconds=300
leader.imbalance.per.broker.percentage=10
#...
```

The percentage imbalance for a broker is the gap between the current number of partition leaders it holds and the number of partitions which are preferred leaders. The first broker in a partition’s list of replicas is known as the preferred leader. You can set the percentage to zero to ensure that preferred leaders are always elected.

If the checks for rebalances need more control, you can disable automated rebalances. You can then choose when to trigger a rebalance using the `kafka-leader-election.sh` command line tool.
Alternatively, you can [use Cruise Control for Strimzi](https://strimzi.io/docs/operators/latest/using.html#cruise-control-concepts-str) to change partition leadership and rebalance replicas across your Kafka cluster in a more intelligent way.

>The Grafana dashboards provided with Strimzi show metrics for under-replicated partitions and partitions that do not have an active leader.

### Unclean leader election

Leader election to an in-sync replica is considered _clean_ because it guarantees no loss of data. And this is what happens by default. Kafka waits until the original leader is back online before messages are picked up again.

But what if there is no in-sync replica to take on leadership? If a minimum number of in-sync replicas is not set, and there are no followers in sync with the partition leader when its hard drive fails irrevocably, data is already lost. Not only that, but a new leader cannot be elected because there are no in-sync followers.

If your situation favors availability over durability, you might want to enable _unclean_ leader election.

```properties
# ...
unclean.leader.election.enable=false
# ...
```

Unclean leader election means out-of-sync replicas can become leaders, but you risk losing messages.

### Avoiding unnecessary consumer group rebalances

We''l end this exploration of broker tuning tips by suggesting a useful configuration to avoid unnecessary consumer group rebalances. You can add a delay so the group coordinator waits for members to join before the initial rebalance.

```properties
# ...
group.initial.rebalance.delay.ms=3000
# ...
```

Inevitably, there's a trade-off as the delay prevents the group from consuming until the period has ended.

And as we come to end of his post, we can make a general point about any tuning you undertake.
Have a clear idea of what you hope to achieve with your tuning, but be mindful of what compromises you might have to make to achieve the outcome you seek.

## Conclusion

So that completes a targeted roundup of the most common broker tuning options for your consideration.
Try them out and keep your messages flowing.   
