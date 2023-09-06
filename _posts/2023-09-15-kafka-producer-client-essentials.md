---
layout: post
title: "Developing Kafka clients: A simple producer client"
date: 2023-09-15
author: paul_mellor
---

Strimzi simplifies the deployment and management of Kafka clusters in a Kubernetes environment, ensuring a smooth and hassle-free experience.
But the real fun begins once your cluster is up and running.
That's when you can start thinking about how to interact with Kafka to stream data.
In other words, Kafka doing the job it excels at.

In this post, we'll dive into the essentials of developing a Kafka producer client that can send messages to a Strimzi-managed Kafka cluster.
To illustrate these concepts, we'll walk through a basic example of a self-contained application that generates and produces messages to a specific Kafka topic.

## Getting started with your producer client

The first thing to consider when developing a producer client application is your preferred programming language. 

After you've decided on that, as a bare minimum, your application must be able to connect to the Kafka cluster and use producers to send messages.

Let's break down the essential steps to get started:

1. Start by choosing the Kafka client library that speaks your choice of programming language. We use Java in this post, but you can use Python, .NET, and so on.

2. Get the library through a package manager or by downloading it from the source.

3. Import the classes and dependencies that your Kafka client will need into your code.

4. Tell your client how to find and connect with your Kafka cluster, specifying configuration properties for broker address and port, and, if required, security credentials.

5. Create a producer object to subscribe to topics and produce messages to Kafka.

    > A client can be a Kafka producer and consumer. 

6. Introduce error handling for connections and communication with your Strimzi-managed Kafka cluster.

## Creating the Kafka producer client

Let's get down to creating the producer client.
Our brief is to create a client that operates asynchronously, and is equipped with basic error-handling capabilities. 
To handle messages, it makes use of Kafka's `Callback` interface. 

### Prerequisites

To be able to operate, the producer client needs the following in place:

* Running kafka brokers 
* A Kafka topic where it sends messages

We can specify the connection details and the name of the topic in our client configuration.

### Client constants

Now, let's define some customizable constants that we'll also use with the producer.

**BOOTSTRAP_SERVERS**

An address and port where the producer client connects to the Kafka cluster is always needed. 
For example, localhost:9092 might be your starting point.
We can define it with this constant.

**TOPIC_NAME**

The name of the topic where the producer client sends its messages.

**NUM_MESSAGES**:
      
This constant sets the number of messages the client produces before it hits the pause button.

**MESSAGE_SIZE_BYTES**

We'll use this constant to adjust the size of each message in bytes.

**PROCESSING_DELAY_MS**

Sometimes, it's good to slow things down a bit. 
We can use this constant to add a delay in milliseconds between sending messages. 
Adding a  delay can be useful when testing in order to simulate typical message processing time.

These constants give us some control over the producer client's behavior. 

### Example producer client

Time to create our client.
We want our example client to operate as follows:

* Create a Kafka producer instance, which is responsible for sending messages to a Kafka topic.
* Generate random message payloads, represented as byte arrays, that serve as the content of the messages being sent to Kafka cluster.
* Use serializer classes that handle the transformation of message keys (IDs) and values (byte arrays) into a format suitable for the Kafka brokers. 
* Control the rate at which messages are produced by introducing delays between each message using our `PROCESSING_DELAY_MS` value.
* Handle errors that may occur during message transmission to the Kafka broker, determining when a message should be retried and when an error is considered non-recoverable. 

**Producer configuration**

We'll specify the following configuration properties for our producer instance:

* `BOOTSTRAP_SERVERS_CONFIG` for connection to the Kafka brokers. This picks up the value of the `BOOTSTRAP_SERVERS` constant.
* `CLIENT_ID_CONFIG` that uses a randomly generated UUID as a client ID for tracking the source of requests.
* `KEY_SERIALIZER_CLASS_CONFIG` and `VALUE_SERIALIZER_CLASS_CONFIG` to specify serializers that transform messages into a format suitable for Kafka brokers. 
In this case, we'll specify the `ByteArraySerializer` as we want to transform byte array values.

We'll also include methods that help with these operations:

**`sleep` method**

- Introduces a delay in the message-sending process for a specified number of milliseconds.
- Useful for controlling the message production rate or simulating message processing times.
- Handles potential `InterruptedException` if the thread is interrupted while paused.

**`randomBytes` method**

- Generates a random byte array of a specified size to serve as the payload for each message sent to the Kafka topic. Adds 65 to represent an uppercase letter in ASCII code (65 is 'A', 66 is 'B', and so on).
- Ensures that the payload size is greater than zero and throws an `IllegalArgumentException` if not.

**`retriable` method**

- Determines whether to retry sending a message following a message sending error.
- Returns `true` if the message sending process can be retried.
- Returns `false` for null and specified exceptions, or those that do not implement the `RetriableException` interface.
- Customizable to include other errors.

**`onCompletion` method**

- Confirms successful message transmission and displays information about the message sent, including the topic, partition, and offset.
- Prints an error message on exception. Appropriate action is taken based on whether it's a fatal or non-fatal error. If the error is non-fatal, the message sending process continues. If the error is fatal, a stack trace is printed and the producer is terminated.

With the imported libraries, our constants, and these configuration properties and methods, the producer client can do all we set out to do.

**Example producer client**
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
    private static final long NUM_MESSAGES = 100;
    private static final int MESSAGE_SIZE_BYTES = 100;
    private static final long PROCESSING_DELAY_MS = 0L;

    protected AtomicLong messageCount = new AtomicLong(0);

    public static void main(String[] args) {
        new Producer().run();
    }

    public void run() {
        System.out.println("Running producer");
        try (var producer = createKafkaProducer()) {
            // Create a Kafka producer instance
            // This producer sends messages to the Kafka topic asynchronously

            byte[] value = randomBytes(MESSAGE_SIZE_BYTES);
            while (messageCount.get() < NUM_MESSAGES) {
                // Generate a random byte array as the message payload

                sleep(PROCESSING_DELAY_MS);

                producer.send(new ProducerRecord<>(TOPIC_NAME, messageCount.get(), value), this);
                // Send a message to the Kafka topic, specifying topic name, message count, and message value

                messageCount.incrementAndGet();
            }
        }
    }

    private KafkaProducer<Long, byte[]> createKafkaProducer() {
        // Create properties for the Kafka producer
        Properties props = new Properties();

        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        // Configure the connection to Kafka brokers

        props.put(ProducerConfig.CLIENT_ID_CONFIG, "client-" + UUID.randomUUID());
        // Set a unique client ID for tracking

        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, LongSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        // Configure serializers for keys and values

        return new KafkaProducer<>(props);
    }

    private void sleep(long ms) {
        // sleep method
        try {
            TimeUnit.MILLISECONDS.sleep(ms);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
    }

    private byte[] randomBytes(int size) {
        // randomBytes method
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
        // retriable method

        if (e == null) {
            return false;
        } else if (e instanceof IllegalArgumentException
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

#### Running the producer client

To put this client into action, simply run the main method in the `Producer` class. 
When running, it creates the message payloads using randomly generated byte arrays. 
The client produces messages until it reaches the predefined message count, which is 100 messages with the `NUM_MESSAGES` constant value we specified. 

> With its thread-safe design, multiple threads can share a single producer instance.

##### Error handling

When developing a Kafka producer client, it's important to consider how you want it to handle different types of exceptions. 

The error handling capabilities we introduced ensures that the producer client can recover from certain non-fatal errors while addressing others as fatal, terminating operation of the client when necessary. 

Here's a breakdown of fatal and non-fatal errors that the client handles:

**Fatal errors caught by the producer client**

* `InterruptedException`: This error occurs when the current thread is interrupted while paused. 
Interruption typically happens during producer shutdown or when stopping its operation. 
The exception is rethrown as a `RuntimeException`, which ultimately terminates the producer.

* `IllegalArgumentException`: This error is thrown when the producer receives invalid or inappropriate arguments. 
For instance, it can be triggered if essential details like the topic are missing.

* `UnsupportedOperationException`: This error is raised when an operation is not supported or when a method is not implemented as expected. 
For instance, it can be triggered if you attempt to use an unsupported producer configuration or invoke a method that the `KafkaProducer` class does not support.

**Non-fatal errors caught by the producer client**

`RetriableException`: This type of error is thrown for any exception that implements the `RetriableException` interface, as provided by the Kafka client library.

### Tuning your producer

The example Kafka producer client in this post serves as a foundation. 
Feel free to build on it.
For instance, you might want to add custom functionality for integration with your preferred logging framework.

You might also want to explore how to expand and improve on other aspects of your client through configuration:

**Implementing security**

Implement security to establish a secure connection using authentication and authorization mechanisms when connecting to the Kafka cluster. 
For example, you can set up TLS authentication for external clients in your Strimzi environment and add the TLS certificates to your client configuration. 

> Configure the security protocol used by your client application to match the protocol configured on a Kafka broker listener. 

**Improving data durability** 
  
Specify `acks=all` in your producer configuration so that all in-sync topic replicas acknowledge successful message delivery. 
Or configure `transaction` properties in your brokers and producer client application to ensure that messages are processed in a single transaction.

**Boosting performance** 
  
Optimize your producer for high message throughput and low latency. 
Use the `linger.ms` and `batch.size` configuration properties to batch more messages into a single produce request for higher throughput. 
Improve throughput of your message requests by using the `delivery.timeout.ms` property to adjust the maximum time to wait before a message is delivered and completes a send request. 

**Introducing further error handling** 
  
Introduce more fine-grained error handling capabilities that also improve the resilience of the client.

### Send a message

In this blog post, we've explored how to develop a Kafka producer client.
We've covered the essential steps, illustrated with an example that highlights asynchronous message production and effective error handling.
Remember, the key to a successful producer client lies in its ability to connect and communicate with a Kafka cluster. 
Once you have that foundation, you define how you want your client to produce and send messages.
For example, Kafka producer clients typically pull data from external sources. 
The possibilities for developing a producer client are vast and entirely dependent on your specific needs.
Go on, try the example and see where it takes you.