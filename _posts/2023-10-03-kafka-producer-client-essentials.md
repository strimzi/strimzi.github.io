---
layout: post
title: "Developing Kafka client applications: A simple producer"
date: 2023-10-03
author: paul_mellor
---

Strimzi simplifies the deployment and management of Apache Kafka clusters in a Kubernetes environment, ensuring a smooth and hassle-free experience.
But the real fun begins once your cluster is up and running.
That's when you can start thinking about how to interact with Kafka to stream data.
In other words, Kafka doing the job it excels at.

In this post, we'll dive into the essentials of developing a Kafka producer application that can send messages to a Strimzi-managed Kafka cluster.
To illustrate these concepts, we'll walk through a basic example of a self-contained application that generates and produces messages to a specific Kafka topic.

> This blog post assumes some basic Java knowledge or experience. 
> If you're new to Java, familiarizing yourself with the fundamentals of the Java programming language will help you better understand the code and concepts presented here.

## Getting started with your producer application

The first thing to consider when developing a producer application is your preferred programming language. 

After you've decided on that, as a bare minimum, your application must be able to connect to the Kafka cluster and use producers to send messages.

Let's break down the essential steps to get started:

1. Start by choosing the Kafka client library that speaks your choice of programming language. We use Java in this post, but you can use Python, .NET, and so on. The Java client is part of the Apache Kafka project. 

2. Get the library through a package manager or by downloading it from the source.

3. Import the classes and dependencies that your Kafka client will need into your code.

4. Tell your client how to find and connect with your Kafka cluster by specifying a list of bootstrap servers, each represented as an address and port combination, and, if required, security credentials.

5. Create a producer instance to publish messages to Kafka topics.

    > A client can be a Kafka producer, consumer, Streams processor, and admin. 

6. Pay attention to error handling; it's vitally important when connecting and communicating with Kafka, especially in production systems where high availability and ease of operations are valued. 
Effective error handling is a key differentiator between a prototype and a production-grade application, and it applies not only to Kafka but also to any robust software system.

## Creating the Kafka producer application

Let's get down to creating the producer application.
Our brief is to create a client that operates asynchronously, and is equipped with basic error-handling capabilities. 
The application implements the [producer `Callback` interface](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/clients/producer/Callback.java), which provides a method for asynchronous handling of request completion in a background thread.

### Adding dependencies

Before implementing the Kafka producer application, our project must include the necessary dependencies.
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

To be able to operate, the producer application needs the following in place:

* A running Kafka cluster 
* A Kafka topic where it sends messages 

We can specify the connection details and the name of the topic in our client configuration.

> By default, cluster configuration has `auto.create.topics.enable=true`, which means a topic is automatically created on the first request.

### Client constants

Now, let's define some customizable constants that we'll also use with the producer.

**BOOTSTRAP_SERVERS**

The initial connection point to the Kafka cluster. 
You can specify a list of host/port pairs to establish this connection.
For a local Kafka deployment, you might start with a value like `localhost:9092`. 
However, when working with a Strimzi-managed Kafka cluster, you can obtain the bootstrap address from the `Kafka` custom resource status using a `kubectl` command:

```shell
kubectl get kafka <kafka_cluster_name> -o=jsonpath='{.status.listeners[*].bootstrapServers}{"\n"}'
```

This command retrieves the bootstrap addresses exposed by listeners for client connections on a Kafka cluster. 
Listeners define how clients communicate with the Kafka brokers, ensuring that you connect to the correct advertised listener port.
In production environments, you can use a single load balancer, or a list of brokers in place of a single bootstrap server.

**TOPIC_NAME**

The name of the topic where the producer application sends its messages.

**NUM_MESSAGES**
      
The number of messages the client produces before it shuts down.

**MESSAGE_SIZE_BYTES**

The size of each message in bytes.

**PROCESSING_DELAY_MS**

Sometimes, it's good to slow things down a bit. 
We can use this constant to add a delay in milliseconds between sending messages. 
Adding a delay can be useful when testing in order to simulate typical message creation patterns.
In Kafka, messages typically capture streams of events, so introducing delays can help simulate peak or average event rates.

These constants give us some control over the producer application's behavior.
We can use the `NUM_MESSAGES` and `PROCESSING_DELAY_MS` values to adjust the message sending rate.
With the current settings, a total of 50 messages are sent with a delay of 1 second between them.

### Example producer application

Time to create our client.
We want our example client to operate as follows:

* Create a Kafka producer instance, which is responsible for sending messages to a Kafka topic.
* Generate a random message payload, represented as a byte array, that serves as the content of the messages being sent to Kafka cluster.
* Use serializer classes that handle the transformation of message keys and values into a format suitable for the Kafka brokers. 
* Produce messages until a specified number of messages (`NUM_MESSAGES`) is reached.
* Control the rate at which messages are produced by introducing delays between each message using our `PROCESSING_DELAY_MS` value.
* Handle errors that may occur during message transmission to the Kafka broker, determining when a message should be retried and when an error is considered non-recoverable. 

**Producer configuration**

We'll specify the minimal configuration properties required for a producer instance:

* `BOOTSTRAP_SERVERS_CONFIG` for connection to the Kafka brokers. This picks up the value of the `BOOTSTRAP_SERVERS` constant.
* `CLIENT_ID_CONFIG` that uses a randomly generated UUID as a client ID for tracking the source of requests.
* `KEY_SERIALIZER_CLASS_CONFIG` and `VALUE_SERIALIZER_CLASS_CONFIG` to specify serializers that transform messages into a format suitable for Kafka brokers. 
In this case, we'll specify the `ByteArraySerializer` because it simply represents the data as bytes without further transformation.

Serializers play a crucial role in transforming messages into a format suitable for transmission to Kafka brokers. 
Kafka allows various serializer options depending on your data types, including string, integer, and JSON.
For more complex data structures or serialization requirements, you can write your custom serializers. 
This allows you to control how your data is serialized and deserialized.

We'll also include methods that help with these operations:

**`sleep` method**

- Introduces a delay in the message-sending process for a specified number of milliseconds.
- Useful for controlling the message production rate or simulating message processing times.
- Handles potential `InterruptedException` if the thread responsible for sending messages is interrupted while paused.

**`randomBytes` method**

- Generates a random byte array of a specified size to serve as the payload for each message sent to the Kafka topic. Adds 65 to represent an uppercase letter in ASCII code (65 is 'A', 66 is 'B', and so on).
- Ensures that the payload size is greater than zero and throws an `IllegalArgumentException` if not.

**`retriable` method**

- Determines whether to retry sending a message following a message sending error.
- Returns `true` if the message sending process can be retried. The Kafka producer automatically handles retries for certain errors, such as connection errors.
- Returns `false` for null and specified exceptions, or those that do not implement the `RetriableException` interface.
- Customizable to include other errors and  implementing retry logic for business level exceptions.

> By default, Kafka operates with at-least-once message delivery semantics, which means that messages can be delivered more than once in certain scenarios, potentially leading to duplicates. 
> To avoid this risk, consider enabling transactions in your Kafka producer. 
> Transactions provide stronger guarantees of exactly-once delivery. 
> Additionally, you can use the `retries` configuration property to control how many times the producer will retry sending a message before giving up. 
> This setting affects how many times the `retriable` method may return `true` during a message send error. 
> For more information, see the [Strimzi post on transactions](https://strimzi.io/blog/2023/05/03/kafka-transactions/) and the [Strimzi documentation on ordered delivery](https://strimzi.io/docs/operators/latest/deploying#ordered_delivery).

**`onCompletion` method**

- Confirms successful message transmission and displays information about the message sent, including the topic, partition, and offset.
- Prints an error message on exception. Appropriate action is taken based on whether it's a retriable or non-retriable error. If the error is retriable, the message sending process continues. If the error is non-retriable, a stack trace is printed and the producer is terminated.

With the imported libraries, our constants, and these configuration properties and methods, the producer application can do all we set out to do.

**Example producer application**
```java
import java.util.Properties;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import org.apache.kafka.clients.producer.Callback;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.errors.RetriableException;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.LongSerializer;

public class Producer implements Callback {
    // Constants for configuration
    private static final Random RND = new Random(0);
    private static final String BOOTSTRAP_SERVERS = "localhost:9092";
    private static final String TOPIC_NAME = "my-topic";
    private static final long NUM_MESSAGES = 50;
    private static final int MESSAGE_SIZE_BYTES = 100;
    private static final long PROCESSING_DELAY_MS = 1000L;

    protected AtomicLong messageCount = new AtomicLong(0);

    public static void main(String[] args) {
        new Producer().run();
    }

    public void run() {
        System.out.println("Running producer");

        // Create a Kafka producer instance
        // This producer sends messages to the Kafka topic asynchronously
        try (var producer = createKafkaProducer()) {
            // Generate a random byte array as the message payload
            byte[] value = randomBytes(MESSAGE_SIZE_BYTES);
            while (messageCount.get() < NUM_MESSAGES) {
                sleep(PROCESSING_DELAY_MS);                
                // Send a message to the Kafka topic, specifying topic name, message key, and message value
                producer.send(new ProducerRecord<>(TOPIC_NAME, messageCount.get(), value), this);
                messageCount.incrementAndGet();
            }
        }
    }

    private KafkaProducer<Long, byte[]> createKafkaProducer() {
        // Create properties for the Kafka producer
        Properties props = new Properties();
        
        // Configure the connection to Kafka brokers
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);

        // Set a unique client ID for tracking
        props.put(ProducerConfig.CLIENT_ID_CONFIG, "client-" + UUID.randomUUID());
        
        // Configure serializers for keys and values
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, LongSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);

        return new KafkaProducer<>(props);
    }

    private void sleep(long ms) {
        try {
            TimeUnit.MILLISECONDS.sleep(ms);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
    }

    private byte[] randomBytes(int size) {
        // Checks the MESSAGE_SIZE_BYTES value is valid
        if (size <= 0) {
            throw new IllegalArgumentException("Record size must be greater than zero");
        }
        byte[] payload = new byte[size];
        for (int i = 0; i < payload.length; ++i) {
            payload[i] = (byte) (RND.nextInt(26) + 65);
        }
        return payload;
    }

    private boolean retriable(Exception e) {
        if (e instanceof IllegalArgumentException
            || e instanceof UnsupportedOperationException
            || !(e instanceof RetriableException)) {
            return false;
        } else {
            return true;
        }
    }

    @Override
    public void onCompletion(RecordMetadata metadata, Exception e) {
        if (e != null) {
            // If an exception occurred while sending the record
            System.err.println(e.getMessage());

            if (!retriable(e)) {
                // If the exception is not retriable, print the stack trace and exit
                e.printStackTrace();
                System.exit(1);
            }
        } else {
            // If the record was successfully sent
            System.out.printf("Record sent to %s-%d with offset %d%n",
                    metadata.topic(), metadata.partition(), metadata.offset());
        }
    }
}
```

### Running the producer application

To put this client into action, simply run the main method in the `Producer` class. 
When running, it creates the message payload using randomly generated byte array. 
The client produces messages to the specified topic (`TOPIC_NAME`) until it reaches the predefined message count, which is 50 messages with the `NUM_MESSAGES` constant value we specified. 

> Kafka producer instances are designed to be thread-safe, allowing multiple threads to share a single producer instance.

### Error handling

When developing a Kafka producer application, it's important to consider how you want it to handle different types of exceptions. 

The error handling capabilities we introduced ensures that the producer application can recover from certain retriable errors while addressing others as non-retriable, terminating operation of the client when necessary. 

Here's a breakdown of retriable and non-retriable errors that the client handles:

**Non-retriable errors caught by the producer application**

* `InterruptedException`: This error occurs when the current thread is interrupted while paused. 
Interruption typically happens during producer shutdown or when stopping its operation. 
The exception is rethrown as a `RuntimeException`, which ultimately terminates the producer.

* `IllegalArgumentException`: This error is thrown when the producer receives invalid or inappropriate arguments. 
For instance, it can be triggered if essential details like the topic are missing.

* `UnsupportedOperationException`: This error is raised when an operation is not supported or when a method is not implemented as expected. 
For instance, it can be triggered if you attempt to use an unsupported producer configuration, leading to a runtime exception.

**Retriable errors caught by the producer application**

`RetriableException`: This type of error is thrown for any exception that implements the `RetriableException` interface, as provided by the Kafka client library.

## Tuning your producer

The example Kafka producer application in this post serves as a foundation. 
Feel free to build on it and customize it to suit your specific needs.
Consider the following aspects carefully, as they really impact the performance and behavior of a producer application:

1. Compression: Implementing message compression can reduce network bandwidth usage, conserving resources and improving throughput.
2. Batching: Adjusting the batch size and time intervals when the producer sends messages can affect throughput and latency. 
3. Partitioning: Partitioning strategies in the Kafka cluster can support producers through parallelism and load balancing, whereby producers can write to multiple partitions concurrently and each partition receives an equal share of messages. Other strategies might include topic replication for fault tolerance.

You might also want to explore how to expand and improve on other aspects of your client through configuration.

**Implementing security**

Ensure a secure connection when connecting to your Kafka cluster by implementing security measures for authentication, encryption, and authorization. In Strimzi, this process involves configuring listeners and user accounts:

* Listener configuration: Use the `Kafka` resource to configure listeners for client connections to Kafka brokers.
Listeners define how clients authenticate, such as using TLS, SCRAM-SHA-512, OAuth 2.0, or custom authentication methods.
To enhance security, configure TLS encryption to secure communication between Kafka brokers and clients.
You can further secure TLS-based communication by specifying the supported TLS versions and cipher suites in the Kafka broker configuration.
For an added layer of protection, you can also specify authorization methods in your listener configuration, such as simple, OAuth 2.0, OPA, or custom authorization.

* User Accounts: Set up user accounts and credentials with `KafkaUser` resources in Strimzi. 
Users represent your clients and determine how they should authenticate and authorize with the Kafka cluster. 
The authentication and authorization mechanisms used must match the Kafka configuration. 
Additionally, define Access Control Lists (ACLs) to control user access to specific topics and actions for more fine-grained authorization.
You can also add configuration to limit the TLS versions and cipher suites your client uses.

Implementing security can be a complex topic, but Strimzi simplifies the process for you. For more information on securing access to Kafka brokers using `Kafka` and `KafkaUser` resources, see the [Strimzi documentation describing how to secure access to Kafka brokers](https://strimzi.io/docs/operators/latest/deploying#assembly-securing-kafka-str).

> You can use configuration providers to load configuration, including secrets, from external sources.
For example, you can use the `KubernetesSecretConfigProvider` to extract TLS certificates and keys directly from the Kubernetes API. 
For more information, see the [Strimzi documentation on configuration providers](https://strimzi.io/docs/operators/latest/deploying#assembly-loading-config-with-providers-str).  

**Improving data durability** 
  
Specify `acks=all` (default) in your producer configuration so that all in-sync topic replicas acknowledge successful message delivery. 
Or configure `transaction` properties in your producer application to ensure that messages are processed in a single transaction.

**Boosting performance** 
  
Optimize your producer for high message throughput and low latency. 
We mentioned that compression and batching are important considerations.
Use the `compression.type` property to specify a producer-side message compression type. 

The `producer.send` method is asynchronous and buffers messages for batching.
Use the `linger.ms` and `batch.size` configuration properties to batch more messages into a single produce request for higher throughput. 
Modifying `linger.ms` and `batch.size` influences message sending behavior in relation to the `PROCESSING_DELAY_MS` setting.
For example, if you set `PROCESSING_DELAY_MS` to 1000 ms and `LINGER_MS` to 5000 ms, messages are not sent out with a 1-second delay between them (as specified by `PROCESSING_DELAY_MS`), rather they are batched and sent every 5 seconds (as specified by `linger.ms`).

The `producer.send` method is asynchronous and buffers messages for batching.
Use the `linger.ms` and `batch.size` configuration properties to batch more messages into a single produce request for higher throughput. 
Modifying these properties impacts the message sending rate in relation to the `PROCESSING_DELAY_MS` setting.
For example, if you set `PROCESSING_DELAY_MS` to 1000 ms and `linger.ms` to 5000 ms, messages are batched and sent every 5000 ms (as specified by `linger.ms`).

You can also improve throughput of your message requests by using the `delivery.timeout.ms` property to adjust the maximum time to wait before a message is delivered and completes a send request. 

For more information, see the [Strimzi documentation on tuning producers](https://strimzi.io/docs/operators/latest/deploying#con-producer-config-properties-str).

**Introducing further error handling** 
  
Introduce more fine-grained error handling capabilities that also improve the resilience of the client.

## Send a message 

In this blog post, we've explored how to develop a Kafka producer application.
We've covered the essential steps, illustrated with an example that highlights asynchronous message production and effective error handling.
Remember, while connectivity is fundamental for client applications, the key to a successful producer client lies in its ability to effectively send messages using mechanisms like batching and by making use of efficient partitioning strategies within the Kafka cluster.
The possibilities for developing a producer application are vast and entirely dependent on your specific needs.
Go on, try the example and see where it takes you.

**RELATED POSTS**

* [Developing Kafka client applications: A simple consumer](https://strimzi.io/blog/2023/10/11/kafka-consumer-client-essentials/)
* [Optimizing Kafka producers](https://strimzi.io/blog/2020/10/15/producer-tuning/)