---
layout: post
title: "Kafka transactions (exactly-once semantics)"
date: 2023-04-14
author: federico_valeri
---

Apache Kafka is a distributed streaming platform that allows efficient and reliable processing of messages.
It is widely used in various industries for data streaming applications, such as processing real-time data, event sourcing, and microservices integration.
One of the key features of Kafka is the support for transactions, which provides exactly-once semantics (EOS) and is available since Kafka 0.11 ([KIP-98](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)).
The support for EOS was recently extended to source connectors in Kafka Connect, which enables configuration-driven and fully transactional streaming pipelines ([KIP-618](https://cwiki.apache.org/confluence/display/KAFKA/KIP-618%3A+Exactly-Once+Support+for+Source+Connectors)).

As messages flow through Kafka, they can be processed by multiple consumers, and ensuring that all consumers that should receive a message actually receive it once and only once can be crucial.
The EOS guarantees that any set of operations inside Kafka will be completed atomically, either all of the operations succeed or none of them do.
This is done by defining transaction boundaries that dictate which operations can be grouped together in a single transaction.
These operations can include reading from topics, writing to topics, and committing offsets.
A failure during processing can cause a transaction to be aborted, in which case none of the messages from the transaction will be readable by consumers.
This helps in maintaining high levels of reliability and consistency as data is processed throughout the application's lifetime.

<!--more-->

### Delivery guarantees

In distributed systems like Kafka, any component can fail independently and you have to deal with this fact.
A broker may crash or a network failure may happen while the producer is sending a message to a topic.

Depending on the configuration, you can have three different delivery semantics:

- **at-most-once**: the producer does not retry when there is a timeout or error (data loss risk)
- **at-least-once**: the producer retries but the broker can fail after writing but before sending the ack (duplicates risk)
- **exactly-once**: even if the producer retries sending a message, it is written exactly once (idempotency)

With at-least-once, there is no way for the producer to know the nature of the failure, so it simply assumes that the message was not written and retries.
There are use cases in which lost or duplicated messages are acceptable, but in others this would cause serious business problems (e.g. financial institutions).

To be fair, there is no such thing as exactly-once delivery in distributed systems (two generals problem), but we can fake it by implementing idempotent operations.
Another way to achieve EOS is to apply a deduplication logic at the consumer side, but this is a stateful logic that needs to be replicated in every consumer.

Since Kafka 3.0, the producer enables the strongest delivery guarantees by default (`acks=all`, `enable.idempotence=true`).
In addition to durability, this provides partition level message ordering and duplicates protection.

When the idempotent producer is enabled, the broker registers the producer id (PID) and the epoch (producer session).
A sequence number is assigned to each record when the batch is first added to a produce request and never changed, even if the batch is resent.
The broker keeps track of the sequence number per producer and partition, periodically storing this information in `.snapshot` files.
Whenever a new batch arrives, the broker checks if the last received number is equal to the first batch number plus one, then the batch is acknowledged, otherwise it is rejected.

Unfortunately, the idempotent producer does not guarantee atomicity when you need to write to multiple partitions as a single unit of work.
This is the typical scenario with many stream processing applications that run read-process-write cycles.
In this case, you can use transactions API or Streams API to make these cycles atomic.
The transaction API is low level and you need to ensure the right configuration and to commit offsets within the scope of the transaction.
Instead, with the Streams API you can simply set `processing.guarantee=exactly_once_v2` to enable EOS on your existing topology.

### Considerations

Each producer must configure its own static and unique `transactional.id` (TID) to enable the zombie fencing logic, which avoids message duplicates.
The TID is used to uniquely identify the same producer instance across process restarts, and it is associated with the producer session.
When starting, the producer must call `initTransactions` one time, so that the broker can complete any open transaction with the given TID and increment the epoch.
Once the epoch is incremented, any producers with the same TID and an older epoch are considered zombies, and are fenced off as soon as they try to send data.

> Before Kafka 2.6 the TID had to be a static encoding of the input partitions in order to avoid ownership transfer between application instances during rebalances, that would invalidate the fencing logic.
> This limitation was ugely inefficient, because an application instance couldn't reuse a single thread-safe producer instance, but had to create one for each input partition. 
> It was fixed with by forcing the producer to send the consumer group metadata along with the offsets to commit ([KIP-447](https://cwiki.apache.org/confluence/display/KAFKA/KIP-447%3A+Producer+scalability+for+exactly+once+semantics)).

To guarantee message ordering, a given producer can have at most one open transaction.
Consumers with `isolation.level=read_committed` are not allowed to advance to offsets which include open transactions, while messages from aborted transactions are filtered out.

The `TransactionCoordinator` is a module running inside every Kafka broker.
Each coordinator owns a subset of the partitions in the internal `__transaction_state` topic (i.e. the partitions for which its broker is the leader).
The coordinator automatically aborts any ongoing transaction that is not completed within `transaction.timeout.ms`.

It is important to note that transactions are only supported inside a single Kafka cluster.
If the transaction scope includes external systems, you would need to use an additional component such as `ChainedKafkaTransactionManager` from the SpringBoot project.
This component is able to synchronize a database transaction with the Kafka transaction.

#### Transaction states

A transaction goes through the following states:

1. **Undecided** (Ongoing)
2. **Decided and unreplicated** (PrepareCommit\|PrepareAbort)
3. **Decided and replicated** (CompleteCommit\|CompleteAbort)

Non-transactional batches are considered decided immediately, but transactional batches are only decided when the corresponding commit or abort marker is written (control record).

The high watermark (HW) is the offset of the last message that was successfully committed (replicated to all in-sync replicas).
The first unstable offset (FUO) is the earliest offset that is part of the ongoing transaction, if present.
The last stable offset (LSO) is the offset such that all lower offsets have been decided and it is always present.
The LSO is equal to the FUO if it's lower than the HW, otherwise it's the HW (LSO <= HW <= LEO).

![txn log](/assets/images/posts/2023-04-14-kafka-txn-log.png)

#### Error handling

If Kafka authorization is enabled, you need to configure the appropriate ACLs rules to avoid `TransactionalIdAuthorizationException`.

In the following example we allow any `transactional.id` from any user.

```sh
$ kafka-acls.sh --bootstrap-server:9092 --command-config client.properties --add \
  --allow-principal User:* --operation write --transactional-id *
```

If any of the send operations inside the transaction scope fails, the final `commitTransaction` will fail and throw the exception from the last failed send.
When this happens, your application should call `abortTransaction` to reset the state and apply a retry strategy.
Some errors cannot be recovered and the application should terminate (`ProducerFencedException`, `FencedInstanceIdException`, `OutOfOrderSequenceException`).

#### Monitoring

When running in production, it is important to monitor the health of your Kafka deployments to maintain reliable performance.
Some of the metrics that Kafka provides can be useful when dealing with transaction issues and tuning.

On the broker side, you should should collect at least the count and 99 percentile for the following APIs.

```sh
# requests: FindCoordinator, InitProducerId, AddPartitionsToTxn, Produce, EndTxn
kafka.network:type=RequestMetrics,name=RequestsPerSec,request=([\w]+)
kafka.network:type=RequestMetrics,name=RequestQueueTimeMs,request=([\w]+)
kafka.network:type=RequestMetrics,name=TotalTimeMs,request=([\w]+)
kafka.network:type=RequestMetrics,name=LocalTimeMs,request=([\w]+)
kafka.network:type=RequestMetrics,name=RemoteTimeMs,request=([\w]+)
kafka.network:type=RequestMetrics,name=ThrottleTimeMs,request=([\w]+)
kafka.network:type=RequestMetrics,name=ResponseQueueTimeMs,request=([\w]+)
kafka.network:type=RequestMetrics,name=ResponseSendTimeMs,request=([\w]+)
attributes:Count,99thPercentile
```

Producer metrics are more difficult to collect, but they help when broker logs reveal some misbehavior.

```sh
kafka.producer:type=producer-metrics,client-id=([-.\w]+)
attributes:txn-init-time-ns-total,txn-begin-time-ns-total,txn-send-offsets-time-ns-total,txn-commit-time-ns-total,txn-abort-time-ns-total
```

### Drawbacks

There are a few drawbacks when using Kafka transactions that developers should be aware of.

Firstly, transactions can add some latency to an application due to the write amplification required to ensure EOS.
While this may not be a significant issue for some applications, those that require real-time processing may be affected.

For each transaction we have the following overhead, which is independent of the number of messages: 

- some RPCs to register the partitions with the coordinator (can be batched)
- one marker has to be written to each partition when completing a transaction
- few state change records are appended to the internal transaction state log

Most of this latency is on the producer side, where the transactions API is implemented.
The performance degradation can be significant when having short transaction commit intervals.
Increasing the transaction duration also increases the end-to-end latency, so it's a matter of tradeoff.

Another potential drawback is hanging transactions, which are transactions with a missing or out of order control record.
They may be caused by a network issue causing delayed messages (see [KIP-890](https://cwiki.apache.org/confluence/display/KAFKA/KIP-890%3A+Transactions+Server-Side+Defense)).

A hanging transaction is usually revealed by a stuck application with growing lag.
Despite messages being produced, consumers can't make any progress because the LSO does not grow anymore.

```sh
[Consumer clientId=my-client, groupId=my-group] The following partitions still have unstable offsets which are not cleared on the broker side: [__consumer_offsets-27], 
this could be either transactional offsets waiting for completion, or normal offsets waiting for replication after appending to local log
```

Additionally, if the partition belongs to a compacted topic, this causes the unbounded partition growth, because the `LogCleaner` does not clean beyond the LSO.
If not detected and fixed in time, this may lead to disk space exhaustion and service disruption.

Fortunately, there are embedded tools that can be used to find all hanging transactions and rollback them.
After that, the LSO starts to increment again on every transaction completion and the application should be able to recover.

```sh
# find all hanging transactions in a broker
$ kafka-transactions.sh --bootstrap-server :9092 find-hanging --broker 0
Topic                  Partition   ProducerId  ProducerEpoch   StartOffset LastTimestamp               Duration(s)
__consumer_offsets     27          171100      1               913095344   2022-06-06T03:16:47Z        209793

# abort an hanging transaction
$ kafka-transactions.sh --bootstrap-server :9092 abort --topic __consumer_offsets --partition 27 --start-offset 913095344
```

### Basic example

Let's now run a basic example to see how transactions work at the partition level.
You just need a computer with few essential command line tools.

This application consumes text messages from the `input-topic`, reverts their content and sends the result to the `output-topic`.

![txn app](/assets/images/posts/2023-04-14-kafka-txn-app.png)

In the following snippet we start the cluster, run the application and create a single transaction.
For the sake of simplicity, we use a single-node Kafka cluster running on localhost, but the example also works with a multi-node cluster.

```sh
# download the Apache Kafka binary and start a single-node Kafka cluster in background
$ KAFKA_VERSION="3.4.0" KAFKA_HOME="$(mktemp -d -t kafka.XXXXXXX)" PATH="$KAFKA_HOME/bin:$PATH" && export KAFKA_HOME PATH

$ curl -sLk "https://archive.apache.org/dist/kafka/$KAFKA_VERSION/kafka_2.13-$KAFKA_VERSION.tgz" \
  | tar xz -C "$KAFKA_HOME" --strip-components 1

$ zookeeper-server-start.sh -daemon $KAFKA_HOME/config/zookeeper.properties \
  && sleep 5 && kafka-server-start.sh -daemon $KAFKA_HOME/config/server.properties

# open a new terminal, get and run the application (Ctrl+C to stop)
$ git clone git@github.com:fvaleri/examples.git -n --depth=1 --filter=tree:0 && cd examples \
  && git sparse-checkout set --no-cone kafka/kafka-txn && git checkout 5907e0bd31175b5f411dc0e0804cf69cde76ec90
...
HEAD is now at 5907e0b Add SerializationException

$ export BOOTSTRAP_SERVERS="localhost:9092" INSTANCE_ID="kafka-txn-0" \
  GROUP_ID="my-group" INPUT_TOPIC="input-topic" OUTPUT_TOPIC="output-topic"

$ mvn clean compile exec:java -q -f kafka/kafka-txn/pom.xml
Starting instance with TID kafka-txn-0
Created topics: input-topic
Waiting for new data
...

# come back to the previus terminal and send a test message
$ kafka-console-producer.sh --bootstrap-server :9092 --topic input-topic
>test
>^C
```

All of this is pretty boring, but now comes the interesting part.

How can we identify which partitions are involved in this transaction and inspect their content?
We are writing to the `output-topic` which has only one partition, but the internal topics for storing CG offsets and transaction states have 50 partitions each by default.

To avoid looking at 100 partitions in the worst case scenario, we can use the same hashing function that Kafka uses to find the coordinating partition.
This function maps `group.id` to `__consumer_offsets` partition, and `transactional.id` to `__transaction_state` partition.

```sh
# define the function and find the coordinating partitions
$ kafka-cp() {
  local id="${1-}" part="${2-50}"
  if [[ -z $id ]]; then echo "Missing id parameter" && return; fi
  echo 'public void run(String id, int part) { System.out.println(abs(id.hashCode()) % part); }
    private int abs(int n) { return (n == Integer.MIN_VALUE) ? 0 : Math.abs(n); }
    run("'"$id"'", '"$part"');' | jshell -
}

$ kafka-cp my-group
12

$ kafka-cp kafka-txn-0
30
```

Knowing the coordinating partitions, we can take a look at their content using the embedded dump tool.
Note how we pass the decoder parameter when dumping from internal topics, whose content is encoded for performance reasons.

```sh
# dump output-topic-0
$ kafka-dump-log.sh --deep-iteration --print-data-log --files /tmp/kafka-logs/output-topic-0/00000000000000000000.log
Dumping /tmp/kafka-logs/output-topic-0/00000000000000000000.log
Log starting offset: 0
baseOffset: 0 lastOffset: 0 count: 1 baseSequence: 0 lastSequence: 0 producerId: 0 producerEpoch: 0 partitionLeaderEpoch: 0 isTransactional: true isControl: false deleteHorizonMs: OptionalLong.empty position: 0 CreateTime: 1680383687941 size: 82 magic: 2 compresscodec: none crc: 2785707995 isvalid: true
| offset: 0 CreateTime: 1680383687941 keySize: -1 valueSize: 14 sequence: 0 headerKeys: [] payload: tset
baseOffset: 1 lastOffset: 1 count: 1 baseSequence: -1 lastSequence: -1 producerId: 0 producerEpoch: 0 partitionLeaderEpoch: 0 isTransactional: true isControl: true deleteHorizonMs: OptionalLong.empty position: 82 CreateTime: 1680383688163 size: 78 magic: 2 compresscodec: none crc: 3360473936 isvalid: true
| offset: 1 CreateTime: 1680383688163 keySize: 4 valueSize: 6 sequence: -1 headerKeys: [] endTxnMarker: COMMIT coordinatorEpoch: 0

# dump __consumer_offsets-12 using the offsets decoder
$ kafka-dump-log.sh --deep-iteration --print-data-log --offsets-decoder --files /tmp/kafka-logs/__consumer_offsets-12/00000000000000000000.log
Dumping /tmp/kafka-logs/__consumer_offsets-12/00000000000000000000.log
Starting offset: 0
...
baseOffset: 1 lastOffset: 1 count: 1 baseSequence: 0 lastSequence: 0 producerId: 0 producerEpoch: 0 partitionLeaderEpoch: 0 isTransactional: true isControl: false deleteHorizonMs: OptionalLong.empty position: 339 CreateTime: 1665506597950 size: 118 magic: 2 compresscodec: none crc: 4199759988 isvalid: true
| offset: 1 CreateTime: 1680383688085 keySize: 26 valueSize: 24 sequence: 0 headerKeys: [] key: offset_commit::group=my-group,partition=input-topic-0 payload: offset=1
baseOffset: 2 lastOffset: 2 count: 1 baseSequence: -1 lastSequence: -1 producerId: 0 producerEpoch: 0 partitionLeaderEpoch: 0 isTransactional: true isControl: true deleteHorizonMs: OptionalLong.empty position: 457 CreateTime: 1665506597998 size: 78 magic: 2 compresscodec: none crc: 3355926470 isvalid: true
| offset: 2 CreateTime: 1680383688163 keySize: 4 valueSize: 6 sequence: -1 headerKeys: [] endTxnMarker: COMMIT coordinatorEpoch: 0
...
```

As you can see, the consumer offsets and the output message are committed as an atomic unit.
In `wc-output-0`, we see that the data batch is transactional and contains the producer's state (PID and epoch).
This data batch is followed by a control batch, which contains the end transaction marker (COMMIT).
In `__consumer_offsets-12`, the consumer group offset commit batch is followed by a similar control batch.

We can also look at how the transaction states are stored by the coordinator.

```sh
# dump __transaction_state-20 using the transaction log decoder
kafka-dump-log.sh --deep-iteration --print-data-log --transaction-log-decoder --files /tmp/kafka-logs/__transaction_state-30/00000000000000000000.log
Dumping /tmp/kafka-logs/__transaction_state-30/00000000000000000000.log
Log starting offset: 0
baseOffset: 0 lastOffset: 0 count: 1 baseSequence: -1 lastSequence: -1 producerId: -1 producerEpoch: -1 partitionLeaderEpoch: 0 isTransactional: false isControl: false deleteHorizonMs: OptionalLong.empty position: 0 CreateTime: 1680383478420 size: 122 magic: 2 compresscodec: none crc: 2867569944 isvalid: true
| offset: 0 CreateTime: 1680383478420 keySize: 17 valueSize: 37 sequence: -1 headerKeys: [] key: transaction_metadata::transactionalId=kafka-txn-0 payload: producerId:0,producerEpoch:0,state=Empty,partitions=[],txnLastUpdateTimestamp=1680383478418,txnTimeoutMs=60000
baseOffset: 1 lastOffset: 1 count: 1 baseSequence: -1 lastSequence: -1 producerId: -1 producerEpoch: -1 partitionLeaderEpoch: 0 isTransactional: false isControl: false deleteHorizonMs: OptionalLong.empty position: 122 CreateTime: 1680383687954 size: 145 magic: 2 compresscodec: none crc: 3735151334 isvalid: true
| offset: 1 CreateTime: 1680383687954 keySize: 17 valueSize: 59 sequence: -1 headerKeys: [] key: transaction_metadata::transactionalId=kafka-txn-0 payload: producerId:0,producerEpoch:0,state=Ongoing,partitions=[output-topic-0],txnLastUpdateTimestamp=1680383687952,txnTimeoutMs=60000
baseOffset: 2 lastOffset: 2 count: 1 baseSequence: -1 lastSequence: -1 producerId: -1 producerEpoch: -1 partitionLeaderEpoch: 0 isTransactional: false isControl: false deleteHorizonMs: OptionalLong.empty position: 267 CreateTime: 1680383687961 size: 174 magic: 2 compresscodec: none crc: 3698066654 isvalid: true
| offset: 2 CreateTime: 1680383687961 keySize: 17 valueSize: 87 sequence: -1 headerKeys: [] key: transaction_metadata::transactionalId=kafka-txn-0 payload: producerId:0,producerEpoch:0,state=Ongoing,partitions=[output-topic-0,__consumer_offsets-12],txnLastUpdateTimestamp=1680383687960,txnTimeoutMs=60000
baseOffset: 3 lastOffset: 3 count: 1 baseSequence: -1 lastSequence: -1 producerId: -1 producerEpoch: -1 partitionLeaderEpoch: 0 isTransactional: false isControl: false deleteHorizonMs: OptionalLong.empty position: 441 CreateTime: 1680383688149 size: 174 magic: 2 compresscodec: none crc: 1700234506 isvalid: true
| offset: 3 CreateTime: 1680383688149 keySize: 17 valueSize: 87 sequence: -1 headerKeys: [] key: transaction_metadata::transactionalId=kafka-txn-0 payload: producerId:0,producerEpoch:0,state=PrepareCommit,partitions=[output-topic-0,__consumer_offsets-12],txnLastUpdateTimestamp=1680383688148,txnTimeoutMs=60000
baseOffset: 4 lastOffset: 4 count: 1 baseSequence: -1 lastSequence: -1 producerId: -1 producerEpoch: -1 partitionLeaderEpoch: 0 isTransactional: false isControl: false deleteHorizonMs: OptionalLong.empty position: 615 CreateTime: 1680383688180 size: 122 magic: 2 compresscodec: none crc: 3020616838 isvalid: true
| offset: 4 CreateTime: 1680383688180 keySize: 17 valueSize: 37 sequence: -1 headerKeys: [] key: transaction_metadata::transactionalId=kafka-txn-0 payload: producerId:0,producerEpoch:0,state=CompleteCommit,partitions=[],txnLastUpdateTimestamp=1680383688154,txnTimeoutMs=60000
```

In `__transaction_state-20` record payloads, we can see all transaction state changes keyed by `transactionalId`.
The transaction starts in the `Empty` state, then we have the `Ongoing` state change every time a new partition is registered.
When the commit is called, a process similar to the two-phase commit produces the two final state changes: `PrepareCommit` and `CompleteCommit`.

### Conclusion

Transactions in Apache Kafka are a powerful tool for ensuring consistency and reliability.
By providing exactly-once semantics, Kafka enables applications to better manage their data processing and prevent errors.
However, these advantages come at the cost of additional latency, which may require tuning in some use cases.
If not monitored, hanging transactions can be a concrete risk for cluster stability.
