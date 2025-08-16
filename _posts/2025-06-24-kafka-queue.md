---
layout: post
title:  "Using Queues for Apache Kafka with Strimzi"
date: 2025-06-24
author: tina_selenge
---

The Queues for Kafka feature was introduced by [KIP-932](https://cwiki.apache.org/confluence/display/KAFKA/KIP-932%3A+Queues+for+Kafka#KIP932:QueuesforKafka) and is in early access in Apache Kafka version 4.0 which is supported from Strimzi 0.46. In this blog, I’m going to introduce this feature and show how you can try it out with your Strimzi managed cluster. 

This feature is only supported with Kafka clusters running in KRaft mode, since Zookeeper was removed in the Apache Kafka 4.0 release. It is also based on the new consumer rebalance protocol introduced by [KIP-848](https://cwiki.apache.org/confluence/display/KAFKA/KIP-848%3A+The+Next+Generation+of+the+Consumer+Rebalance+Protocol) that enhances stability, scalability and performance. 

Traditional message queues and Kafka topics are significantly different in terms of design and use cases. A queue allows a group of consumers to read and process records in parallel to distribute the workload. It does not provide a strong ordering guarantee as records in a queue are consumed and processed independently. However it typically provides exactly-once guarantee as each record is only read once and is deleted from the queue. States of individual records are usually tracked and acknowledged after being processed successfully to avoid prematurely removing records off the queue or to handle unprocessable records. This also means that records in a queue are not replayable, therefore a queue can only be consumed by a single group of consumers.

On the other hand, a Kafka topic can be consumed by multiple consumer groups as it is an immutable log and reading of records does not result in removal. However, workload distribution cannot be achieved alone with consumers. A topic has to be partitioned in order to spread the workload across a consumer group. It also provides an ordering mechanism by using record keys.

The Queues for Kafka feature allows you to use a Kafka topic like a traditional message queue and increase parallelism of message processing beyond the number of partitions. It provides queue-like semantics through a new consumer group called <b>share group</b> to enable use cases for traditional message queue. This new type of group gives more fine-grained control on message acknowledgement and retries.

The key difference between share group and regular consumer group is how partitions get assigned to consumer members. With regular consumer groups, each partition is exclusively assigned to a single member of the consumer group. Therefore users typically can have as many consumer members as the number of partitions to maximise the parallelism in message processing. Moreover, due to this, users tend to over partition their topics in order to cope with peak loads that may only happen sometimes. However, share groups balance partitions between all members of a share group, allowing multiple consumer members to fetch from the same partition. So users can have more consumers than the number of partitions, further increasing the parallelism and they do not need to over partition their topics, but can just scale up and down their consumers to cope with the peak loads. When share group members consume from the same partition, each record on that partition is still only read by one consumer in the group.

The share group does not support exactly-once semantics and does not provide ordering guarantee as multiple consumers can fetch records from the same partition. However, these features may potentially be added in the future. The dead letter queue is currently not supported either but there is already an open [KIP](https://cwiki.apache.org/confluence/display/KAFKA/KIP-1191%3A+Dead-letter+queues+for+share+groups) for it.

### Comparing share and consumer groups with Strimzi

I have set up a single node cluster on my machine using Strimzi’s [Quickstart](https://strimzi.io/quickstarts/).
Since this feature is still in early access, as of Apache Kafka 4.0.0, you need to explicitly enable it by setting the following:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  # ...
spec:
  kafka:
    config:
      # ...
      group.coordinator.rebalance.protocols: classic,consumer,share
      unstable.api.versions.enable: true
      share.coordinator.state.topic.replication.factor: 1
    # ...
    version: 4.0.0
    metadataVersion: 4.0-IV3
  # ...
```
Since I'm running a single node cluster, `share.coordinator.state.topic.replication.factor` also had to be set to 1. We will cover more about this topic later.

Then I created a topic called `kafka-queue-topic` with 2 partitions:
```sh
$ cat << EOF | kubectl create -n kafka -f -
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaTopic
metadata:
  name: kafka-queue-topic
  labels:
    strimzi.io/cluster: "my-cluster"
spec:
  partitions: 2
  replicas: 1
EOF
```

Using the Kafka command line tools, I will produce some records on the topic and consume those records using both consumer and share groups and show how they behave differently. 

In this example, I will start with 3 share consumers, all joining the same share group called, `share-group` and then 3 regular consumers, also all joining the same consumer group called, "consumer-group". I will run the following command in different terminal windows with different pod names, e.g.  kafka-share-consumer-0,  kafka-share-consumer-1, kafka-share-consumer-2:
```sh
$ kubectl -n kafka run kafka-share-consumer-0 -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-console-share-consumer.sh \
--bootstrap-server my-cluster-kafka-bootstrap:9092 \
--topic kafka-queue-topic \
--group share-group \
--property print.offset=true \
--property print.partition=true
```

I will do the same for the regular consumers with pod names, kafka-consumer-0, kafka-consumer-1 and kafka-consumer-3:
```sh
$ kubectl -n kafka run kafka-consumer-0 -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-console-consumer.sh \
--bootstrap-server my-cluster-kafka-bootstrap:9092 \
--topic kafka-queue-topic \
--group consumer-group \
--consumer-property group.protocol=consumer \
--property print.offset=true \
--property print.partition=true
```

We can check the pods we have started using the following command:
```sh
$ kubectl get po -n kafka                                                                               
NAME                                          READY   STATUS    RESTARTS   AGE
kafka-consumer-0                              1/1     Running   0          2m24s
kafka-consumer-1                              1/1     Running   0          2m28s
kafka-consumer-2                              1/1     Running   0          2m34s
kafka-share-consumer-0                        1/1     Running   0          2m9s
kafka-share-consumer-1                        1/1     Running   0          2m
kafka-share-consumer-2                        1/1     Running   0          110s
my-cluster-dual-role-0                        1/1     Running   0          7m44s
my-cluster-entity-operator-78d5b9dfd9-5ktxt   2/2     Running   0          10m
strimzi-cluster-operator-5dd46b9985-dp2wt     1/1     Running   0          10m
```

And then random records will be produced to the topic using the `kafka-producer-perf-rest.sh` tool. 
```sh
$ kubectl -n kafka run kafka-producer -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-producer-perf-test.sh \
--producer-props bootstrap.servers=my-cluster-kafka-bootstrap:9092 \
--topic kafka-queue-topic \
--num-records 10000 \
--record-size 10 \
--throughput -1 
```

The following screenshot of the terminal windows shows that all 3 share consumers are receiving the records from both partitions:

![Share group](/assets/images/posts/2025-06-24-kafka-queue-04.png)

The new command line tool, `kafka-share-groups.sh` can be used to describe share groups and their members. The following shows the topic partitions that the share group is subscribed to and their start offsets:
```sh
$ kubectl -n kafka run kafka-tool -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-share-groups.sh \
--bootstrap-server my-cluster-kafka-bootstrap:9092 \
--describe \
--group share-group

GROUP           TOPIC             PARTITION  START-OFFSET
share-group     kafka-queue-topic 0          7903
share-group     kafka-queue-topic 1          13097
```

With the `--members` flag, you can check the share group members and their assignments. As you can see, all the share consumers are assigned to the same partitions and therefore fetch records in parallel:
```sh
$ kubectl -n kafka run kafka-tool -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-share-groups.sh \
--bootstrap-server my-cluster-kafka-bootstrap:9092 \
--describe \
--group share-group \
--members

GROUP           CONSUMER-ID            HOST            CLIENT-ID              ASSIGNMENT
share-group     bSURQb3NTfSDGXQmgRrEeQ /10.244.0.131   console-share-consumer kafka-queue-topic:0,kafka-queue-topic:1
share-group     HY1kEgMFShaumg8xSEc9sw /10.244.0.133   console-share-consumer kafka-queue-topic:0,kafka-queue-topic:1
share-group     cvg5pnSlQ-qzlxocNkTplg /10.244.0.132   console-share-consumer kafka-queue-topic:0,kafka-queue-topic:1
```

Now let’s look at the regular consumer group (note that I am using the new consumer group protocol, not classic). 

![Consumer group](/assets/images/posts/2025-06-24-kafka-queue-05.png)

Only kafka-consumer-1 and kafka-consumer-2 are actively fetching from one partition each but kafka-consumer-0 is idle, not fetching records. Let’s describe this consumer group:

```sh

$ kubectl -n kafka run kafka-tool -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-consumer-groups.sh \
--bootstrap-server my-cluster-kafka-bootstrap:9092 \
--describe \
--group consumer-group \
--members

GROUP           CONSUMER-ID            HOST            CLIENT-ID        PARTITIONS     
consumer-group  i1lwoDQfSTOrPBZuoueWzQ /10.244.0.134   console-consumer 0               
consumer-group  CowB2m5kR5WDz_jIIoEDQw /10.244.0.135   console-consumer 1               
consumer-group  fzNIbX2kTk-Lmxb5SUh-HA /10.244.0.136   console-consumer 1   

$ kubectl -n kafka run kafka-tool -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-consumer-groups.sh \
--bootstrap-server my-cluster-kafka-bootstrap:9092 \
--describe \
--group consumer-group

GROUP           TOPIC             PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID            HOST            CLIENT-ID
consumer-group  kafka-queue-topic 1          13097           13097           0               CowB2m5kR5WDz_jIIoEDQw /10.244.0.135   console-consumer
consumer-group  kafka-queue-topic 0          7903            7903            0               fzNIbX2kTk-Lmxb5SUh-HA /10.244.0.136   console-consumer
```

There are 3 members in this group, but only 2 of them are assigned to a partition each exclusively as the topic has only 2 partitions:

### Partition Assignments

![Partition Assignments](/assets/images/posts/2025-06-24-kafka-queue-01.png)

Partitions are assigned to members of a share group in round robin fashion while trying to maintain even balance in the assignment. Assignments in a share group are dynamic, when a consumer leaves or joins or when a partition is added, all the partitions are rebalanced across the members. As long as a consumer member continues to call the `poll()`, it stays in the group and continues to receive records from its assigned partitions. Similar to a regular consumer group, in the background, members of a share group also send periodic heartbeats to the share group coordinator. If a member doesn’t send a heartbeat request within the <b>group.share.session.timeout.ms</b>, it will be considered inactive and partitions will be reassigned to other members. If it is sending heartbeat requests to the broker, but it does not call the `poll()` within <b>max.poll.interval.ms</b>, then it will leave the group and the partitions will be reassigned as well.

### Fetch mechanism

When a consumer in a share group fetches records, it acquires a batch of records with a time-limited acquisition. Batch size is controlled by the existing fetch configurations such as <b>max.poll.records</b> and <b>fetch.max.bytes</b>. While the records are acquired, they are not available for other consumers. The lock is automatically released once the lock duration has elapsed and the records become available again for another delivery attempt. This makes sure delivery progress even when a consumer fails to process a record. The lock duration can be configured with the broker configuration, <b>group.share.record.lock.duration.ms</b> which is set to 30s by default.

The number of records acquired from a partition by one share group is also limited. Once this limit is reached, fetching of records from the share group temporarily pauses until the number of acquired records reduces. The limit can be configured with the broker configuration, <b>group.share.partition.max.record.locks</b> which is set to 2000 by default.

Records transition through different states when being fetched depending on the actions taken by consumers of a share group. Consumer can:
- Acknowledge once the record is successfully processed
- Release the record, to make it available for another delivery attempt
- Reject the record, if it is unprocessable and the record should not be available for another delivery attempt

If none of the above is done by the consumer e.g. the consumer is still in the middle of processing the record and is taking a long time, the lock will be automatically released once the lock duration has elapsed. 

While a share consumer process records in batches, locking is applied per record even within a fetched batch. Records can be acknowledged both individually or in batches.

### Delivery State

![Delivery state](/assets/images/posts/2025-06-24-kafka-queue-02.png)

Delivery count for each record is tracked and gets incremented every time a consumer acquires the record. There is a limit on the number of times a record can be retried to avoid getting stuck trying to deliver an unprocessable record indefinitely. This limit also can be reconfigured with broker configuration, <b>group.share.delivery.count.limit</b> with default value of 5.

The delivery count determines which state the record should transition into later on. If the consumer releases the record or the lock duration has lapsed, it will go back into <b>Available</b> state as long as the delivery count has not reached the limit. 
The record will go into <b>Acknowledged</b> state if it has been successfully processed by the consumer. If the consumer rejects the record or its delivery count has reached the limit, the record will go into <b>Archived</b> state.

### Share Group State

The share group persists state management for subscribed partitions, by storing it in an internal topic called, `__share_group_state`. This topic stores state of share groups including the partitions they are subscribed to and the state of those partitions such as the Share Partition Start Offset (SPSO) and the Share Partition End Offset (SPEO) as well as the delivery state and delivery count of the records on the partitions. As SPSO and SPEO naturally move forward as records get processed, the records before the SPSO move into <b>Archived</b>. The <b>Archived</b> state represents a record that is removed from the queue.

Normally users would not need to look at the internal topic, but for the purpose of this blog, we can check the records in this topic using the console consumer tool:
```sh
$ kubectl -n kafka run share-group-state -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-bootstrap:9092 --topic __share_group_state --from-beginning  --formatter=org.apache.kafka.tools.consumer.group.share.ShareGroupStateMessageFormatter
```

The following is an example of the records produced to this topic which is in JSON format:
```json
{
  "key": {
    "version": 0,
    "data": {
      "groupId": "my-share-group",
      "topicId": "9fagJTJNTaa-FwT6umvvCA",
      "partition": 0
    }
  },
  "value": {
    "version": 0,
    "data": {
      "snapshotEpoch": 2,
      "stateEpoch": 0,
      "leaderEpoch": 0,
      "startOffset": 560,
      "stateBatches": [
        {
          "firstOffset": 560,
          "lastOffset": 560,
          "deliveryState": 0,
          "deliveryCount": 1
        },
        {
          "firstOffset": 561,
          "lastOffset": 564,
          "deliveryState": 2,
          "deliveryCount": 1
        },
        {
          "firstOffset": 565,
          "lastOffset": 565,
          "deliveryState": 4,
          "deliveryCount": 1
        }
      ]
    }
  }
}
```
Subscribed partitions’ states are stored in batches as records get consumed and acknowledged in batches too. In the example above, you can see the batch of states, one of which is for offsets between 561 and 564. These offsets have the same delivery state and count therefore share the same state. In comparison, the offset 560 and 565 have different delivery states therefore listed in individual states.

<i>Map of the states and enums:</i>

| Enum | State |
| :--: |:-------------|
| 0    | Available    |
| 2    | Acknowledged |
| 4    | Archived     |

Let’s take a look at the following example of a partition that a share group is subscribed to, which is called <b>Share Partition</b>:

![Delivery state](/assets/images/posts/2025-06-24-kafka-queue-03.png)

In this example, offset 2 is the start offset of the share group consuming from the partition. Records at offset 2 and 4 are currently <b>Acquired</b> for the first time, therefore delivery count is incremented to 1. However, the record at offset 3 is in <b>Available</b> state with delivery count of 2, which means a consumer of the share group has attempted to deliver this record twice so far and it will be retried until the maximum delivery count is reached. The record at offset 5 has been processed successfully and <b>Acknowledged</b> and the record at offset 6 is the next available record to be acquired by the share group, therefore it is the end offset for this share partition.

### KafkaShareConsumer API

Let’s look at the new [KafkaShareConsumer](https://kafka.apache.org/40/javadoc/org/apache/kafka/clients/consumer/KafkaShareConsumer.html) Java API added for share group consumers. It looks very similar to KafkaConsumer API which makes it easier to use the new API if you are already familiar with it. With the KafkaShareConsumer API, users can do more fine grained acknowledgements of the records that are consumed and processed. There are 2 different mechanisms to acknowledge records:

#### <i>Acknowledging records in batches</i>

When acknowledging a batch of records, the implicit acknowledgment is used by calling the `poll()`. In the following example, I’ve created a simple share consumer client that implicitly acknowledges batches of records:

```java
public class ShareGroupDemoImplicitAck {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @SuppressWarnings("InfiniteLoopStatement")
    public static void main(final String[] args) {
        Properties consumerProps = new Properties();
        consumerProps.setProperty("bootstrap.servers", "localhost:9092");
        // join the share group
        consumerProps.setProperty("group.id", "my-share-group");
        consumerProps.setProperty("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
        consumerProps.setProperty("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");

        KafkaShareConsumer<String, String> consumer = new KafkaShareConsumer<>(consumerProps);

        consumer.subscribe(List.of("kafka-queue-topic"));

        while (true) {
            ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000)); // #1

            for (ConsumerRecord<String, String> record : records) {
                try {
                    processRecord(record);
                } catch (JsonProcessingException e) { // #2
                    System.out.println("Failed to process the record- Offset: " + record.offset() + " Value: " + record.value());
                }
            }
        }
    }

    private static void processRecord(ConsumerRecord<String, String> record) throws JsonProcessingException {
        JsonNode json = OBJECT_MAPPER.readTree(record.value());
        System.out.println("Processed record with offset " + record.offset() + ": " + json.toPrettyString());
    }
}
```
#1. When fetching another batch of records by calling `poll()`, the batch of records delivered in the previous poll are marked as successfully processed and acknowledged. This is the simplest and the most efficient way to acknowledge records.

#2. In this example, no exception is thrown if it fails to process a record. It just catches the `JsonProcessingException` and prints a log message. In this case, the record still gets implicitly acknowledged in the next `poll()`.

#### <i>Acknowledging individual records</i>

This allows users to acknowledge an individual record depending on the outcome of processing the record. Each record is acknowledged using a call to `acknowledge()` which takes different types of acknowledgement as an argument: ACCEPT, RELEASE and REJECT. This aligns with the actions that can be taken by share group consumers mentioned previously.

I’ve created another share consumer client that explicitly acknowledges batches of records:

```java
public class ShareGroupDemoExplicitAck {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @SuppressWarnings("InfiniteLoopStatement")
    public static void main(final String[] args) {
        Properties producerProps = new Properties();
        producerProps.setProperty("bootstrap.servers", "localhost:9092");
        producerProps.setProperty("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
        producerProps.setProperty("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
        KafkaProducer<String, String> producer = new KafkaProducer<>(producerProps);

        Properties consumerProps = new Properties();
        consumerProps.setProperty("bootstrap.servers", "localhost:9092");
        // join the share group
        consumerProps.setProperty("group.id", "my-share-group");
        consumerProps.setProperty("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
        consumerProps.setProperty("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
        consumerProps.setProperty("share.acknowledgement.mode", "explicit"); // #1

        KafkaShareConsumer<String, String> consumer = new KafkaShareConsumer<>(consumerProps);

        consumer.subscribe(List.of("kafka-queue-topic"));

        while (true) {
            ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));

            for (ConsumerRecord<String, String> record : records) {
                if (record.key() != null && "skip".equals(record.key())) {  // #2 
                    System.out.println("Skipping the record - Offset: " + record.offset() +
                            " Key: " + record.key() +
                            " Value: " + record.value() +
                            " Delivery count: " + record.deliveryCount().get());
                    consumer.acknowledge(record, AcknowledgeType.RELEASE);
                    break; // #3
                } else {
                    try {
                        processRecord(record);
                    } catch (JsonProcessingException e) {
                        System.out.println("Failed to process the record- Offset: " + record.offset() + " Value: " + record.value());
                        handlePoisonRecord(record, producer); // #4
                        consumer.acknowledge(record, AcknowledgeType.REJECT);  // #5
                    } catch (Exception e ) {
                        System.out.println("Failed to process the record- Offset: " + record.offset() + " Value: " + record.value());
                        consumer.acknowledge(record, AcknowledgeType.RELEASE); // #6
                    }
                }
                
                consumer.acknowledge(record, AcknowledgeType.ACCEPT); // #7
            }
            consumer.commitSync(); // #7
        }
    }

    private static void processRecord(ConsumerRecord<String, String> record) throws JsonProcessingException {
        JsonNode json = OBJECT_MAPPER.readTree(record.value());
        System.out.println("Processed record with offset " + record.offset() + ": " + json.toPrettyString());
    }

    private static void handlePoisonRecord(ConsumerRecord<String, String> record, KafkaProducer<String, String> producer) {
        producer.send(new ProducerRecord<>("dead-letter-queue-topic", record.key(), record.value()));
    }
}

```

#1. In this example, I have used the new consumer configuration added for this feature, `share.acknowledgement.mode` and set it to `explicit`. This configuration is set to `implicit` by default, which is why I didn’t need to set this configuration for the previous example. 

#2. The consumer immediately releases a record if its key is set to `skip`, just to demonstrate the retry of delivery attempts. The record is fetched again in the next call to `poll()` and eventually hits the maximum delivery attempts. Then it is transitioned into <b>Archived</b> state because the client never processes it. Once archived, this record is no longer available for another delivery. 

#3. If the record's key is `skip`, it exits the loop so that we demonstrate the delivery retry and what happens if some records are not acknowledged during the poll. 

#4. Also when a record value cannot be mapped to a valid JSON object, the processing method throws a `JsonProcessingException` and the client handles it as a poison record. Since the dead letter queue is not supported yet, users have to implement this themselves. In this example, we send the records that cannot be processed to another topic `dead-letter-queue-topic`. 

#5. Once a poison record is sent to the dead letter queue topic, the consumer client rejects it so that it gets archived immediately. 

#6. If the client encounters an error not caused by the JSON mapping, it releases the record for another attempt because it could be a transient failure.

#7. When no exception occurred during the processing, the consumer client accepts the record. Once all the records in the batch are processed and acknowledged individually, these states are stored locally in the consumer. 

#8. Then the client has to call `commitSync()` or `commitAsync()` to commit the state to the internal topic, `__share_group_state`. In #2, it exits the loop for processing each record, and commits the state by calling `commitSync()`. The records in the batch that were not processed or acknowledged yet, will be presented to the consumer client again as part of the same acquisition, therefore their delivery count will not be incremented. Also note that share groups also do not support auto-commit.

Here is an example of a client application using [KafkaProducer](https://kafka.apache.org/40/javadoc/org/apache/kafka/clients/producer/KafkaProducer) to send records in valid and invalid format to `kafka-queue-topic` used for this demonstration:

```java
public class ShareGroupDemoProducer {
    public static void main(final String[] args) throws InterruptedException, ExecutionException {
        Properties props = new Properties();
        props.setProperty("bootstrap.servers", "localhost:9092");
        props.setProperty("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
        props.setProperty("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");

        KafkaProducer<String, String> producer = new KafkaProducer<>(props);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutdown hook triggered. Cleaning up...");
            producer.close();
        }));

        int recordNum = 1;
        while (true) {
            String recordKey = null;
            String recordValue;
            if (recordNum % 10 == 0) {
                // Send every 10th record with in not processable format
                recordValue = "Poison message: this record is not in JSON format (recordNumber: " + recordNum + ")";
            } else if(recordNum % 5 == 0) {
                // Send every 5th record with key "skip"
                recordKey = "skip";
                recordValue = "Record to skip processing";
            } else {
                recordValue = "{ \"isJson\": \"true\", \"recordNumber\": " + recordNum + ", \"recordValue\": \"This is test message\" }";
            }

            ProducerRecord record = new ProducerRecord<>("kafka-queue-topic", recordKey, recordValue);
            RecordMetadata metadata = (RecordMetadata) producer.send(record).get();
            System.out.println("Produced record at offset " + metadata.offset() + ": " + record.value());
            recordNum++;
            Thread.sleep(Long.valueOf(2000));
        }
    }
}
```

#### <i>Inspecting __share_group_state topic</i>

Let’s now take a look at the output from `ShareGroupDemoExplicitAck` while running `ShareGroupDemoProducer` at the same time:
```sh
Failed to process the record- Offset: 361 Value: Poison message: this record is not in JSON format (recordNumber: 10)
Processed record with offset 362: {
  "isJson" : "true",
  "recordNumber" : 11,
  "recordValue" : "This is test message"
}
Processed record with offset 363: {
  "isJson" : "true",
  "recordNumber" : 12,
  "recordValue" : "This is test message"
}
Processed record with offset 364: {
  "isJson" : "true",
  "recordNumber" : 13,
  "recordValue" : "This is test message"
}
Processed record with offset 365: {
  "isJson" : "true",
  "recordNumber" : 14,
  "recordValue" : "This is test message"
}
Skipping the record - Offset: 366 Key: skip Value: Record to skip processing Delivery count: 1
Skipping the record - Offset: 366 Key: skip Value: Record to skip processing Delivery count: 2
Skipping the record - Offset: 366 Key: skip Value: Record to skip processing Delivery count: 3
Skipping the record - Offset: 366 Key: skip Value: Record to skip processing Delivery count: 4
Skipping the record - Offset: 366 Key: skip Value: Record to skip processing Delivery count: 5
Processed record with offset 367: {
  "isJson" : "true",
  "recordNumber" : 16,
  "recordValue" : "This is test message"
}
```

The record at offset 361 was rejected because it hit an error mapping the record value into JSON therefore is considered a poison message. 
The records at offset 362, 363, 364 and 365 were successfully processed and therefore accepted.
The record at offset 366 was however released without getting processed therefore it was retried 5 times before getting archived and no longer being retried. The consumer then continued to the next record at offset 367.

Let’s inspect the state of these records from the internal topic, __share_group_state just to understand the different states the records transitioned through:

```sh
$ kubectl -n kafka run consumer -ti --image=quay.io/strimzi/kafka:0.47.0-kafka-4.0.0 --rm=true --restart=Never \
-- bin/kafka-console-consumer.sh \
--bootstrap-server my-cluster-kafka-bootstrap:9092 \
--topic __share_group_state \
--formatter=org.apache.kafka.tools.consumer.group.share.ShareGroupStateMessageFormatter
```
```json
{
  "key": {
    "version": 1,
    "data": {
      "groupId": "my-share-group",
      "topicId": "9fagJTJNTaa-FwT6umvvCA",
      "partition": 0
    }
  },
  "value": {
    "version": 0,
    "data": {
      "snapshotEpoch": 1,
      "leaderEpoch": 0,
      "startOffset": 361,
      "stateBatches": [
        {
          "firstOffset": 361,
          "lastOffset": 361,
          "deliveryState": 4,
          "deliveryCount": 1
        }
      ]
    }
  }
}
```

The offset 361 that had a bad record was `Archived` (enum 4) state after the first delivery attempt, therefore was not retried again. 

```json
{
  "key": {
    "version": 1,
    "data": {
      "groupId": "my-share-group",
      "topicId": "9fagJTJNTaa-FwT6umvvCA",
      "partition": 0
    }
  },
  "value": {
    "version": 0,
    "data": {
      "snapshotEpoch": 1,
      "leaderEpoch": 0,
      "startOffset": 364,
      "stateBatches": [
        {
          "firstOffset": 364,
          "lastOffset": 364,
          "deliveryState": 2,
          "deliveryCount": 1
        }
      ]
    }
  }
}
{
  "key": {
    "version": 1,
    "data": {
      "groupId": "my-share-group",
      "topicId": "9fagJTJNTaa-FwT6umvvCA",
      "partition": 0
    }
  },
  "value": {
    "version": 0,
    "data": {
      "snapshotEpoch": 1,
      "leaderEpoch": 0,
      "startOffset": 365,
      "stateBatches": [
        {
          "firstOffset": 365,
          "lastOffset": 365,
          "deliveryState": 2,
          "deliveryCount": 1
        }
      ]
    }
  }
}
```

The records at offset 364 and 365 were in <b>Acknowledged</b> (enum 2) after the first delivery attempt, as they were processed and acknowledged successfully by the consumer. (The offset 362 and 363 had the same state, just not included in the output)

```json
{
  "key": {
    "version": 1,
    "data": {
      "groupId": "my-share-group",
      "topicId": "9fagJTJNTaa-FwT6umvvCA",
      "partition": 0
    }
  },
  "value": {
    "version": 0,
    "data": {
      "snapshotEpoch": 1,
      "leaderEpoch": 0,
      "startOffset": 366,
      "stateBatches": [
        {
          "firstOffset": 366,
          "lastOffset": 366,
          "deliveryState": 0,
          "deliveryCount": 1
        }
      ]
    }
  }
}
```

The record at offset 366 was in <b>Available</b> (enum 0) after the first delivery attempt. This is the record the consumer skipped from processing and simply released. However in the next screenshot, we see that delivery attempts have increased.

```json
{
  "key": {
    "version": 1,
    "data": {
      "groupId": "my-share-group",
      "topicId": "9fagJTJNTaa-FwT6umvvCA",
      "partition": 0
    }
  },
  "value": {
    "version": 0,
    "data": {
      "snapshotEpoch": 1,
      "leaderEpoch": 0,
      "startOffset": 366,
      "stateBatches": [
        {
          "firstOffset": 366,
          "lastOffset": 366,
          "deliveryState": 0,
          "deliveryCount": 4
        }
      ]
    }
  }
}
{
  "key": {
    "version": 1,
    "data": {
      "groupId": "my-share-group",
      "topicId": "9fagJTJNTaa-FwT6umvvCA",
      "partition": 0
    }
  },
  "value": {
    "version": 0,
    "data": {
      "snapshotEpoch": 1,
      "leaderEpoch": 0,
      "startOffset": 366,
      "stateBatches": [
        {
          "firstOffset": 366,
          "lastOffset": 366,
          "deliveryState": 4,
          "deliveryCount": 5
        }
      ]
    }
  }
}
```

After 4 attempts of delivery, the record was still in <b>Available</b> (enum 0) state but after the 5th attempt, it went into <b>Archived</b> (enum 4) state, which is why it was not retried again. 

### Broker and share configurations

<i>Summary of the configurations mentioned in this blog:</i>

| Configuration | Type | Default | Description |
| :--: |:-------------| :-------------| :-------------|
| group.coordinator.rebalance.protocols  | Broker   | classic,consumer | It should be set to `classic,consumer,share` to enable share group. |
| unstable.api.versions.enable           | Broker   | false | It should be set to true, in order to use this feature until it is production ready .|
| share.coordinator.state.topic.replication.factor | Broker | 3 | Replication factor for the share-group state topic. Setting this greater than the cluster size will result in failure to create the topic and share group consumers will not work. |
| group.share.record.lock.duration.ms    | Broker   | 30s | The record acquisition lock duration in milliseconds for share groups. |
| group.share.partition.max.record.locks | Broker   | 200 | Share group record lock limit per share-partition. |
| group.share.delivery.count.limit       | Broker   | 5   | The maximum number of delivery attempts for a record delivered to a share group. |
| group.share.session.timeout.ms         | Broker   | 45000 | The timeout to detect client failures when using the share group protocol. |
| fetch.max.bytes                        | Broker   | 57671680 | The maximum number of bytes returned for a fetch request. |
| max.poll.interval.ms                   | Consumer | 300000 | The maximum delay between invocations of `poll()` when using consumer group management. |
| max.poll.records                       | Consumer | 500 | The maximum number of records returned in a single `poll()`. | 
| share.acknowledgement.mode             | Consumer | implicit | Controls the acknowledgement mode for a share consumer. If set to implicit, must not use `acknowledge()`. Instead, delivery is acknowledged in the next `poll()` call. If set to explicit, must use  `acknowledge()` to acknowledge delivery of records. 

The broker configurations can be set in your Kafka CR like shown in the example above. And the consumer configurations can be set in your client application, like shown in the Java API example.

### The current limitations of the feature

This feature is currently not recommended for production clusters as of Apache Kafka 4.0.0 but can be tried out with a test cluster as demonstrated above. If you are trying out this feature on your existing development/test cluster, note that you will not be able to upgrade to Apache Kafka 4.1 or later. You would have to disable this feature first and delete the state topic, in order to upgrade to a later version.

### Summary 

This blog post explored how to configure a Kafka cluster managed by Strimzi to behave like a traditional queue. It introduced the concept of share groups, which enables queue-like consumptions of records, and compares them to regular consumer groups, highlighting their benefits. Through hands-on examples, it demonstrated how to consume and acknowledge records using the new KafkaShareConsumer API to achieve queue-style processing.