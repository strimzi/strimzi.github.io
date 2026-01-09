---
layout: post
title: "Strimzi Test Container: Simplifying Kafka & Connect Testing"
date: 2026-01-06
author: see-quick
---

Testing Kafka based applications used to be a pain.
Back in 2019, your options each came with significant trade-offs, and they still do:
- **Full Kafka clusters** are resource-intensive and hard to manage in CI
- **Mocks** don't behave like real Kafka and become a maintenance burden
- **Embedded Kafka** causes dependency conflicts with your application's Kafka client libraries

We built **Strimzi Test Container** to avoid these issues.

### Why We Built Strimzi Test Container

We needed proper isolation from embedded Kafka's dependency conflicts.
Embedded Kafka runs in the same JVM as your tests, making it difficult to independently version the test cluster and your application's Kafka client libraries.
By running Kafka in a container, we get full isolation (i.e., no classpath conflicts, and you can test against any Kafka version regardless of what your application uses).

But why build our own instead of using existing solutions?
The **main reason** was that the official Testcontainers Kafka module used Confluent Platform containers rather than Apache Kafka.
This meant testing against a private fork instead of the actual Apache Kafka code we use in Strimzi.
We needed to test against the same Apache Kafka builds that run in production, and control our own release cadence to ship new Kafka versions quickly.

Another reason was to support multiple architectures.
Strimzi runs on various platforms: x64, aarch64, IBM Z, and IBM Power.
We needed a testing solution that works consistently across all of them.
Most existing solutions only supported x64 and aarch64 architectures.

### What Does Strimzi Test Container Provide?

Strimzi Test Container provides two main components: `StrimziKafkaCluster` for Kafka broker testing and `StrimziConnectCluster` for Kafka Connect testing.

#### StrimziKafkaCluster

`StrimziKafkaCluster` allows you to programmatically create and manage Docker-based KRaft Kafka clusters in your tests.
It supports both single-node and multi-node cluster configurations (i.e., you can easily create 3, 5, or more Kafka nodes for realistic testing).

> Strimzi Test Container supports only KRaft-based clusters. ZooKeeper-based clusters are no longer supported.

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withSharedNetwork()
    .build();

kafkaCluster.start();

// Your tests here...

kafkaCluster.stop();
```

#### StrimziConnectCluster

Beyond Kafka brokers, we also support **Kafka Connect** testing with `StrimziConnectCluster`.
This allows you to test connectors, transformations, and end-to-end data pipelines in a realistic distributed environment.

```java
// assume that you have pre-defined your `kafkaCluster` before instantiating `connectCluster`. 

StrimziConnectCluster connectCluster = new StrimziConnectCluster.StrimziConnectClusterBuilder()
    .withKafkaCluster(kafkaCluster)
    .withNumberOfWorkers(2)
    .withGroupId("test-connect-cluster")
    .build();

connectCluster.start();

String restEndpoint = connectCluster.getRestEndpoint();
// Deploy and test your connectors...
```

### How It Works

#### Multi-Architecture Support

Strimzi Test Container supports x64, aarch64, Z (s390x), and PPC (ppc64le) architectures.
It uses multi-arch container images and leverages Java cross-platform nature, so the same code works regardless of where you run your tests.

#### Multi-Node Setup with Combined or Dedicated Roles

One of the key features is support for different node role configurations.

**Combined roles (default)** - each node acts as both a KRaft controller and a broker.
This is simpler and works well for most testing scenarios:

![Combined Roles](/assets/images/posts/2026-01-12-strimzi-test-container-01.svg)

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .build();
```

**Dedicated roles** - separate controller and broker nodes, matching production-like deployments:

![Dedicated Roles](/assets/images/posts/2026-01-12-strimzi-test-container-02.svg)

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withDedicatedRoles()
    .withNumberOfControllers(3)
    .build();

// Creates 3 controller-only nodes (IDs: 0, 1, 2)
// and 3 broker-only nodes (IDs: 3, 4, 5)
```

> The diagrams above are just for illustration. 
> You can easily spin up a single-node cluster or configure any number of brokers and controllers to match your testing needs.

#### Multiple Kafka Versions

Test against specific Kafka versions with a single line change:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withKafkaVersion("4.0.1")
    .build();
```

You can also use your own custom images if you have special requirements:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withImage("my-registry.io/my-kafka:custom")
    .build();
```

#### Rich Configuration Options

Pass any Kafka broker configuration you need:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withAdditionalKafkaConfiguration(Map.of(
        "log.retention.hours", "1",
        "min.insync.replicas", "2",
        "compression.type", "snappy"
    ))
    .build();
```

#### OAuth Support

Strimzi Test Container supports OAuth authentication with both `OAUTHBEARER` and `OAUTH_OVER_PLAIN` mechanisms.
This lets you test secure Kafka deployments without setting up a full OAuth infrastructure manually.

### From Strimzi to the Broader Ecosystem

Strimzi Test Container started as an "internal" library for Strimzi projects like Strimzi Kafka Operator and Strimzi Kafka Bridge.
Over time, it expanded beyond Strimzi and is now used by projects like Quarkus and Debezium.

![Strimzi Test Container Ecosystem](/assets/images/posts/2026-01-12-strimzi-test-container-03.svg)

Within the Strimzi ecosystem, we currently use it across multiple subprojects:

- [strimzi-kafka-operator](https://github.com/strimzi/strimzi-kafka-operator)
- [strimzi-kafka-bridge](https://github.com/strimzi/strimzi-kafka-bridge)
- [strimzi-mqtt-bridge](https://github.com/strimzi/strimzi-mqtt-bridge)
- [metrics-reporter](https://github.com/strimzi/metrics-reporter)
- [test-clients](https://github.com/strimzi/test-clients)

### Conclusion

We built Strimzi Test Container because we needed it ourselves.
Turns out, others needed it too.

If you are tired of fighting with embedded Kafka or maintaining Docker Compose files for your tests, give it a spin.
Real Kafka, real behavior, minimal setup.
