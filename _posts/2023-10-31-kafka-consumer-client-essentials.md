---
layout: post
title: "Developing Kafka client applications: A simple consumer"
date: 2023-10-31
author: paul_mellor
---

In our previous blog post, we looked at creating a simple [Kafka producer application](https://strimzi.io/blog/2023/10/03/kafka-producer-client-essentials/), allowing you to send messages to a Strimzi-managed Kafka cluster. 
Now, let's pivot to the receiving end.
Kafka consumers subscribe to topics and read messages from producers based on topics, partitions, and offsets. 
The data read by consumers can then be leveraged to support event-driven applications and real-time analytics.

In this follow-up post, we'll look at developing a Kafka consumer application that can be used with our producer application. 
As with the post on creating a producer application, our focus is on Java. 
However, this time our goal is to build an application that can subscribe to and process messages from a Kafka topic within the Strimzi-managed Kafka cluster.

> This blog post assumes some basic Java knowledge or experience. 
> If you're new to Java, familiarizing yourself with the fundamentals of the Java programming language will help you better understand the code and concepts presented here.

## Getting started with your consumer application

Just like the producer application, development of the Kafka consumer application begins with a few fundamental considerations.

As a bare minimum, your application must be able to connect to the Kafka cluster and use consumers to receive messages.

Let's break down the essential steps to get started:

1. Start by choosing the Kafka client library that speaks your choice of programming language. We use Java in this post, but you can use Python, .NET, and so on. The Java client is part of the Apache Kafka project. 

2. Get the library through a package manager or by downloading it from the source.

3. Import the classes and dependencies that your Kafka client will need into your code.

4. Configure your client to find and connect with your Kafka cluster by specifying a list of bootstrap servers, each represented as an address and port combination, and, if required, security credentials.

5. Create a Kafka Consumer instance to subscribe to and fetch messages from Kafka topics. 

6. Pay attention to error handling; it's vitally important when connecting and communicating with Kafka, especially in production systems where high availability and ease of operations are valued. 
Effective error handling is a key differentiator between a prototype and a production-grade application, and it applies not only to Kafka but also to any robust software system.

## Creating the Kafka consumer application

Let's get down to creating the consumer application.
Our brief is to create a client that operates asynchronously, and is equipped with basic error-handling capabilities. 
The application implements the [`ConsumerRebalanceListener`](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/clients/consumer/ConsumerRebalanceListener.java) interface for partition handling and the [`OffsetCommitCallback` interface](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/clients/consumer/OffsetCommitCallback.java) for committing offsets.

### Adding dependencies

Before implementing the Kafka consumer application, our project must include the necessary dependencies.
For a Java-based Kafka client, we need to include the Kafka client JAR. 
This JAR file contains the Kafka libraries required for building and running the client.

To do this in a Java-based project using Apache Maven, add the Kafka client dependency to your `pom.xml` file as follows:

```xml
<dependencies>
    <dependency>
        <groupId>org.apache.kafka</groupId>
        <artifactId>kafka-clients</artifactId>
        <version>3.5.1</version>
    </dependency>
</dependencies>
```
### Prerequisites

To be able to operate, the consumer application needs the following in place:

* A running Kafka cluster 
* A Kafka topic from where it receives messages 

We can specify the connection details and the name of the topic in our client configuration.

### Client constants

Now, let's define some customizable constants that we'll also use with the consumer.

**BOOTSTRAP_SERVERS**

The initial connection points to the Kafka cluster. 
You can specify a list of host/port pairs to establish this connection.
For a local Kafka deployment, you might start with a value like `localhost:9092`. 
However, when working with a Strimzi-managed Kafka cluster, you can obtain the bootstrap address from the `Kafka` custom resource status using a `kubectl` command:

```shell
kubectl get kafka <kafka_cluster_name> -o=jsonpath='{.status.listeners[*].bootstrapServers}{"\n"}'
```

This command retrieves the bootstrap addresses exposed by listeners for client connections on a Kafka cluster. 
Listeners define how clients communicate with the Kafka brokers, ensuring that you connect to the correct advertised listener port.
In production environments, you can use a single load balancer, or a list of brokers in place of a single bootstrap server.

**GROUP_ID**

The consumer group identifier.
Consumer instances sharing the same group ID form a consumer group and share a subscription so that each partition is consumed by a single consumer instance.

**POLL_TIMEOUT_MS** 

The maximum time to wait for new messages during each poll.
Polling is the process of periodically checking Kafka brokers for new messages.

**TOPIC_NAME**

The name of the topic where the consumer application receives its messages.

**NUM_MESSAGES**
      
The number of messages the client consumes before it shuts down.

**PROCESSING_DELAY_MS**

This constant can simulate typical message consumption patterns, which is especially useful for testing.
Introducing delays to the consumer simulates the time needed by the application to process and digest the data it has received.

These constants give us some control over the consumer application's behavior.
We can use the `NUM_MESSAGES` and `PROCESSING_DELAY_MS` values to adjust the message receiving rate.
With the current settings, a total of 50 messages are received with a delay of 1 second between them.

### Example consumer application

Time to create our client.
We want our example client to operate as follows:

* Create a Kafka consumer instance, which is responsible for receiving messages from a Kafka topic.
* Subscribe to a specific Kafka topic (in this case, `my-topic`) to start receiving messages from it.
* Handle partition assignment, revocation, and loss.
* Use deserializer classes that convert records from raw bytes back into the format used by the producer. The deserializer configuration has to match what was used by the producer side. 
* Consume messages until a specified number of messages (`NUM_MESSAGES`) is reached.
* Control the rate at which messages are consumed by introducing delays between each message using our `PROCESSING_DELAY_MS` value.
* Commit the message offsets asynchronously to Kafka to record the progress of message consumption.
* Handle errors that may occur during message consumption, determining when a message should be retried and when an error is considered non-recoverable. 

**consumer configuration**

We'll specify the minimal configuration properties required for a consumer instance:

* `BOOTSTRAP_SERVERS_CONFIG` for connection to the Kafka brokers. This picks up the value of the `BOOTSTRAP_SERVERS` constant.
* `CLIENT_ID_CONFIG` that uses a randomly generated UUID as a client ID for tracking the source of requests.
* `ENABLE_AUTO_COMMIT_CONFIG` to toggle automatic offset committing by Kafka. We will control offset commits in our application.
* `AUTO_OFFSET_RESET_CONFIG` to define the starting point for consuming messages when no committed offset is found for the configured group ID and assigned partition. This is hardcoded to `earliest` in our example. 
* `KEY_DESERIALIZER_CLASS_CONFIG` and `VALUE_DESERIALIZER_CLASS_CONFIG` to specify deserializers that transform message keys and values into a suitable format. 
In this case, we'll specify the `ByteArrayDeserializer` because this is what we used on the producer.

Producers and consumers can use different serializers and deserializers as long as the consumer's deserializer is capable of correctly interpreting the serialized data produced by the producer's serializer.
In our [producer example](https://strimzi.io/blog/2023/10/03/kafka-producer-client-essentials/), messages are generated as random byte arrays, which serve as the content of the messages sent to the Kafka cluster. Given this format, the `ByteArrayDeserializer` is chosen for deserialization.  

We'll also include methods that help with these operations:

**`sleep` method**

- Introduces a delay in the message-receiving process for a specified number of milliseconds.
- Useful for controlling the message consumption rate or simulating message processing times.
- Handles potential `InterruptedException` if the thread responsible for sending messages is interrupted while paused.

**`retriable` method**

- Determines whether to retry message consumption and offset management following a message consuming error.
- Returns `true` if the message consuming process can be retried. The Kafka consumer automatically handles retries for certain errors, such as connection errors.
- Returns `false` for null and specified exceptions, or those that do not implement the `RetriableException` interface.
- Customizable to include other errors and implementing retry logic for business level exceptions.

> By default, Kafka operates with at-least-once message semantics, which means that messages can be delivered more than once in certain scenarios, potentially leading to duplicates.
> Consider using transactional ids and enabling idempotence (`enable.idempotence=true`) on the producer side to guarantee exactly-once semantics. 
> On the consumer side, you can then use the `isolation.level` property to control how transactional messages are read by the consumer.
> For more information, see the [Strimzi post on transactions](https://strimzi.io/blog/2023/05/03/kafka-transactions/)

**`onPartitionsAssigned` method**

- Provides information about the partitions assigned to the consumer.
- Messages are not consumed during partition assignment. If there is a delay or failure in the consumer being assigned to partitions, this can disrupt the consumption process. 

**`onPartitionsRevoked` method**

- Provides information about the partitions the consumer is about to lose during a rebalance.
- Gives you the opportunity to commit pending offsets before the rebalance occurs.

**`onPartitionsLost` method**

- Provides information about partitions that the consumer has lost ownership of during a rebalance without revoking the ownership gracefully.
- Requires potential cleanup operations since any pending offsets are now owned by other consumers.

**`onComplete` method**

- Provides feedback on the outcome of offset commits.
- Prints an error message on offset commit failures. If a non-retriable error occurs, a stack trace is printed, and the application exits. Non-retriable errors indicate issues like insufficient processing resources or network partitions, which might lead to the application being pushed out of the consumer group.

With the imported libraries, our constants, and these configuration properties and methods, the consumer application can do all we set out to do.

**Example consumer application**
```java
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRebalanceListener;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.consumer.NoOffsetForPartitionException;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.clients.consumer.OffsetCommitCallback;
import org.apache.kafka.clients.consumer.OffsetOutOfRangeException;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.errors.RebalanceInProgressException;
import org.apache.kafka.common.errors.RetriableException;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.LongDeserializer;

import static java.time.Duration.ofMillis;
import static java.util.Collections.singleton;

public class Consumer implements ConsumerRebalanceListener, OffsetCommitCallback {
    // Constants for configuration
    private static final String BOOTSTRAP_SERVERS = "localhost:9092";
    private static final String GROUP_ID = "my-group";
    private static final long POLL_TIMEOUT_MS = 1_000L;
    private static final String TOPIC_NAME = "my-topic";
    private static final long NUM_MESSAGES = 50;
    private static final long PROCESSING_DELAY_MS = 1_000L;

    private KafkaConsumer<Long, byte[]> kafkaConsumer;
    protected AtomicLong messageCount = new AtomicLong(0);
    private Map<TopicPartition, OffsetAndMetadata> pendingOffsets = new HashMap<>();

    public static void main(String[] args) {
        new Consumer().run();
    }

    public void run() {
        System.out.println("Running consumer");

        // Create a Kafka consumer instance
        // This consumer receives messages from the Kafka topic asynchronously
        try (var consumer = createKafkaConsumer()) {
            kafkaConsumer = consumer;
            consumer.subscribe(singleton(TOPIC_NAME), this);
            System.out.printf("Subscribed to %s%n", TOPIC_NAME);
            while (messageCount.get() < NUM_MESSAGES) {
                try {
                    // Poll for new records from Kafka
                    ConsumerRecords<Long, byte[]> records = consumer.poll(ofMillis(POLL_TIMEOUT_MS));
                    if (!records.isEmpty()) {
                        for (ConsumerRecord<Long, byte[]> record : records) {
                            System.out.printf("Record fetched from %s-%d with offset %d%n",
                                record.topic(), record.partition(), record.offset());
                            sleep(PROCESSING_DELAY_MS);

                            // Track pending offsets for commit
                            pendingOffsets.put(new TopicPartition(record.topic(), record.partition()),
                                new OffsetAndMetadata(record.offset() + 1, null));
                            if (messageCount.incrementAndGet() == NUM_MESSAGES) {
                                break;
                            }
                        }
                        // Commit pending offsets asynchronously
                        consumer.commitAsync(pendingOffsets, this);
                        pendingOffsets.clear();
                    }
                } catch (OffsetOutOfRangeException | NoOffsetForPartitionException e) {
                    // Handle invalid offset or no offset found errors when auto.reset.policy is not set
                    System.out.println("Invalid or no offset found, and auto.reset.policy unset, using latest");
                    consumer.seekToEnd(e.partitions());
                    consumer.commitSync();
                } catch (Exception e) {
                    // Handle other exceptions, including retriable ones
                    System.err.println(e.getMessage());
                    if (!retriable(e)) {
                        e.printStackTrace();
                        System.exit(1);
                    }
                }
            }
        }
    }

    private KafkaConsumer<Long, byte[]> createKafkaConsumer() {
        // Create properties for the Kafka consumer
        Properties props = new Properties();

        // Configure the connection to Kafka brokers
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);

        // Set a unique client ID for tracking
        props.put(ConsumerConfig.CLIENT_ID_CONFIG, "client-" + UUID.randomUUID());

        // Set a consumer group ID for the consumer
        props.put(ConsumerConfig.GROUP_ID_CONFIG, GROUP_ID);

         // Configure deserializers for keys and values
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, LongDeserializer.class);
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);

        // Disable automatic offset committing
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

        // Set the offset reset behavior to start consuming from the earliest available offset
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        return new KafkaConsumer<>(props);
    }

    private void sleep(long ms) {
        try {
            TimeUnit.MILLISECONDS.sleep(ms);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
    }

    private boolean retriable(Exception e) {
        if (e == null) {
            return false;
        } else if (e instanceof IllegalArgumentException
            || e instanceof UnsupportedOperationException
            || !(e instanceof RebalanceInProgressException)
            || !(e instanceof RetriableException)) {
            return false;
        } else {
            return true;
        }
    }

    @Override
    public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
        System.out.printf("Assigned partitions: %s%n", partitions);
    }

    @Override
    public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
        System.out.printf("Revoked partitions: %s%n", partitions);
        kafkaConsumer.commitSync(pendingOffsets);
        pendingOffsets.clear();
    }
    
    @Override
    public void onPartitionsLost(Collection<TopicPartition> partitions) {
        System.out.printf("Lost partitions: {}", partitions);
    }

    @Override
    public void onComplete(Map<TopicPartition, OffsetAndMetadata> map, Exception e) {
        if (e != null) {
            System.err.println("Failed to commit offsets");
            if (!retriable(e)) {
                e.printStackTrace();
                System.exit(1);
            }
        }
    }
}
```

### Running the consumer application

To put this client into action, simply run the main method in the `consumer` class. 
The client consumes messages from the specified topic (`TOPIC_NAME`) until it reaches the predefined message count, which is 50 messages with the `NUM_MESSAGES` constant value we specified. 

> The consumer is not designed to be safely accessed concurrently by multiple threads. Ensure that only one instance of the consumer application is running on a single thread to maintain the expected behavior.

### Error handling

When developing a Kafka consumer application, it's important to consider how you want it to handle different types of exceptions. 

The error handling capabilities we introduced ensures that the consumer application can recover from certain retriable errors while addressing others as non-retriable, terminating operation of the client when necessary. 

Here's a breakdown of retriable and non-retriable errors that the client handles:

**Non-retriable errors caught by the consumer application**

* `InterruptedException`: This error occurs when the current thread is interrupted while paused. 
Interruption typically happens during consumer shutdown or when stopping its operation. 
The exception is rethrown as a `RuntimeException`, which ultimately terminates the consumer.

* `IllegalArgumentException`: This error is thrown when the consumer receives invalid or inappropriate arguments. 
For instance, it can be triggered if essential details like the topic are missing.

* `UnsupportedOperationException`: This error is raised when an operation is not supported or when a method is not implemented as expected. 
For instance, it can be triggered if you attempt to use an unsupported consumer configuration, leading to a runtime exception.

**Retriable errors caught by the consumer application**

`RetriableException`: This type of error is thrown for any exception that implements the `RetriableException` interface, as provided by the Kafka client library.

`OffsetOutOfRangeException`: This error is thrown when the consumer attempts to seek to an invalid offset for a partition, typically when the offset is outside the valid range of offsets for that partition, and auto-reset policy is not enabled. To recover, the consumer seeks to the end of the partition to commit the offset synchronously (`commitSync`). If auto-reset policy is enabled, the consumer seeks to the start or end of the partition depending on the setting. 

`NoOffsetForPartitionException`: This error is thrown when there is no committed offset for a partition or the requested offset is invalid, and auto-reset policy is not enabled. To recover, the consumer seeks to the end of the partition to commit the offset synchronously (`commitSync`). If auto-reset policy is enabled, the consumer seeks to the start or end of the partition depending on the setting.

`RebalanceInProgressException`: This error is thrown during a consumer group rebalance when partitions are being assigned. Offset commits cannot be completed when the consumer is undergoing a rebalance. The consumer can wait for the rebalance to complete and then continue processing.

## Tuning your consumer

The consumer application provided in this post serves as a starting point, but you can fine-tune it to align with your specific requirements. 
When tuning a consumer application, consider the following aspects, as they significantly impact its performance and behavior:

1. Scaling: Consumer groups enable parallel processing of messages by distributing the load across multiple consumers. Properly configuring consumer groups can enhance scalability and throughput.
2. Message ordering: A consumer observes messages in a single partition in the same order that they were committed to the broker, which means that Kafka only provides ordering guarantees for messages in a single partition. 
If absolute ordering within a topic is important, use a single-partition topic. 
While a single-partition topic allows only one consumer instance, you can leverage a pool of worker threads to create a multi-threaded consumer for more efficient processing.
Messages processed by different threads might not be in the exact order in which they were produced, so there is a trade-off between parallelism and strict ordering.
When processing messages for specific entities (like users), you can use the ID (like user ID) as the message key and direct all messages to a single partition.
This way, you can maintain message ordering for events specific to individual entities. 
If a new entity is created, you can create a new topic and migrate its data.
3. Offset reset policy: Setting the appropriate offset policy ensures that the consumer consumes messages from the desired starting point and handles message processing accordingly. The default Kafka reset value is `latest`, which starts at the end of the partition, and consequently means some messages might be missed, depending on the consumer's behavior and the state of the partition. In our consumer configuration, we set `AUTO_OFFSET_RESET_CONFIG` to earliest. This ensures that when connecting with a new `group.id`, we can retrieve all messages from the beginning of the log.

You might also want to explore how to expand and improve on other aspects of your client through configuration.

**Choosing the right partition assignment strategy**

Select an appropriate partition assignment strategy, which determines how Kafka topic partitions are distributed among consumer instances in a group.

Specify the strategy using the `partition.assignment.strategy` consumer configuration property. 
The **range** assignment strategy assigns a range of partitions to a consumer. 
Using this strategy, you can assign partitions that store related data to the same consumer.  

Alternatively, opt for a **round robin** assignment strategy for equal partition distribution among consumers, which is ideal for high-throughput scenarios requiring parallel processing.

For more stable partition assignments, consider the **sticky** and **cooperative sticky** strategies. 
Sticky strategies maintain assigned partitions during rebalances, when possible.
The cooperative sticky strategy also supports cooperative rebalances, enabling uninterrupted consumption from partitions that are not reassigned.

If none of the available strategies suit your data, you can create a custom strategy tailored to your specific requirements.

**Implementing security**

Ensure a secure connection when connecting to your Kafka cluster by implementing security measures for authentication, encryption, and authorization. In Strimzi, this process involves configuring listeners and user accounts.

If you're not familiar with the process of implementing security, we summarized it in the post for the [example producer client](https://strimzi.io/blog/2023/10/03/kafka-producer-client-essentials/).

**Avoiding data loss or duplication** 

As mentioned, we use `earliest` as our offset reset policy instead of the `latest` default so that a new consumer retrieves all available messages from the beginning of the log.

We also disable the default Kafka capability to commit offsets automatically.
The Kafka auto-commit mechanism is convenient but introduces a risk of skipping data and duplication. 
To disable the auto-commit mechanism, we set `ENABLE_AUTO_COMMIT_CONFIG` to `false`. 
Instead, we use a combination of the `commitAsync` and `commitSync` APIs to manage offset commits within the application.

We use `commitAsync` for regular offset commits, allowing the consumer to continue polling for new messages without waiting for the offsets to be committed.

However, if the `OffsetOutOfRangeException` or `NoOffsetForPartitionException` errors are thrown, or if we encounter an unrecoverable error, we use `commitSync` to ensure that offsets are correctly handled and committed. 
By using the `commitSync` API, the consumer application will not poll for new messages until the last offset in the batch is committed. 

**Recovering from failure**

Kafka provides mechanisms to detect and recover from failures within consumer groups. Two useful properties that aid in this recovery process are `session.timeout.ms` and `heartbeat.interval.ms`.

The `session.timeout.ms` property specifies the maximum amount of time that can elapse before a consumer in a group must send a heartbeat to the Kafka broker.
This heartbeat is an indicator that the consumer is active in the group. 
If a consumer fails to send a heartbeat within the specified session timeout, Kafka considers it as a failure, and the consumer is marked as inactive.
A consumer marked as inactive triggers a rebalancing of the partitions for the topic.
Setting this value too low can result in false-positive outcomes, while setting it too high can lead to delayed recovery from failures.

The `heartbeat.interval.ms` property determines how frequently a consumer sends heartbeats to the Kafka broker. 
A shorter interval between consecutive heartbeats allows for quicker detection of consumer failures.
The heartbeat interval must be lower, usually by a third, than the session timeout.
Decreasing the heartbeat interval reduces the chance of accidental rebalancing, but more frequent heartbeats increases the overhead on broker resources.

**Minimizing the impact of rebalances**

The consumer application uses the `onPartitionsRevoked` method so that pending offsets are committed before the consumer loses ownership of the partition during a rebalance.

To further reduce potential disruptions caused by rebalances, you can use the `group.instance.id` to assign a unique identifier to each consumer instance within the consumer group (as specified by `GROUP_ID` in our consumer).
This approach minimizes unnecessary partition rebalancing when a consumer rejoins a group after a failure or restart. The consumer continues with the same instance ID and maintains its assignment of topic partitions.

Additionally, adjusting the `max.poll.interval.ms` configuration can prevent rebalances caused by prolonged processing tasks, allowing you to specify the maximum interval between polls for new messages. If lengthy message processing is unavoidable due to factors such as slow external services, consider offloading this processing to a pool of worker threads. 
This setting is more critical than `heartbeat.interval.ms` and `session.timeout.ms` as it relates directly to how the application is driving the consumer client.

Similarly `max.poll.records` limits the number of records returned from the consumer buffer, allowing the consumer application to process fewer messages more efficiently.

## Get the message

In this blog post, we've explored the essentials of creating Kafka consumer applications, covering everything from handling offsets and errors to fine-tuning performance and minimizing the impact of rebalances.

A successful consumer client is all about effectively receiving and processing data from Kafka topics. Just like with producers, the effectiveness of your consumer application depends on your specific use case and requirements, as well as the quality of the data provided by producers.

Kafka's architecture and features make it a powerful platform for real-time and scalable end-to-end data streaming. 
We hope the example [producer application](https://strimzi.io/blog/2023/10/03/kafka-producer-client-essentials/) and consumer application we've discussed in these posts have provided you with valuable insights into building a robust data pipeline for your real-time applications. 
Give them a try and see how they can unlock the full potential of Kafka for your data streaming needs.

**RELATED POSTS**

* [Developing Kafka client applications: A simple producer](https://strimzi.io/blog/2023/10/03/kafka-producer-client-essentials/)
* [Optimizing Kafka consumers](https://strimzi.io/blog/2021/01/07/consumer-tuning/)