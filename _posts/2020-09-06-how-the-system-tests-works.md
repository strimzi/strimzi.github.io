---
layout: post
title:  "How system tests work"
date: 2020-09-06
author: maros_orsak
---
In the [previous blog post](https://strimzi.io/blog/2020/09/21/introduction-to-system-tests/) related to testing we learned 
about our unit tests, integration tests and how they differ from system tests. 
Furthermore, we showed how you can run them on a Kubernetes cluster. 
But, we did not cover system tests themselves in any great detail.
So in this blog post we will take a closer look at our system tests.

## Introduction

The system tests reply on two mandatory things.
* The `Resources` class, which is responsible for creating the testing environment.
* A number of auxiliary classes, which are divided into the classic `Utils` - style static methods, internal clients,
the Apache Kafka Clients for the external communication, Kubernetes client, `Constants.java` and `Environment.java`.

Main idea is to make the system test and its resources easily modifiable and writable in the fluent way. Before, we dive into
the `Resources` class, we need to understand the lifecycle of system tests. 

## Lifecycle of tests

Like any other test lifecycle, we follow the [SEVT](http://xunitpatterns.com/Four%20Phase%20Test.html) convention. 
[SEVT](http://xunitpatterns.com/Four%20Phase%20Test.html) stands for Setup, Exercise, Verify and Teardown.

### Setup phase

In the Setup phase we perform the following actions:

* Create some namespace(s)
* Deploy the Strimzi Cluster operator
* Deploy a Kafka cluster and/or other components (optional)

The reason why the last point is optional, is because we have some test cases where we might want to have a different kafka 
configuration for each test scenario, so creation of the Kafka cluster and other resources is done in the test phase.

We create resources in the Kubernetes cluster using classes in the `resources` package, which allows us to deploy all components and, 
if needed, change their default configurations using the builder pattern.
We do this using three stacks, which are stored in the `ResourceManager` singleton instance. 
When we create a resource, we push it onto the relevant stack, so that we can clean up the resource at the end of the test (teardown phase). 
We have one stack for all test class resources, one for test method resources and one auxiliary, which always points to the class or method stack.
This allows us to create resources during the execution of any test method. 

`ResourceManager` controls which stack is currently active in the `pointer stack`.
You can change between class and method resources stack with method `ResourceManager.setMethodResources()` or `ResourceManager.setClassResources()`.
Note that pointer stack is set automatically in `AbstractST.class` in `@BeforeAll` or `@BeforeEach` methods.

Cluster Operator setup example:

```
@BeforeAll
void createClassResources() {
   ResourceManager.setClassResources();     <--- point resource manager to class stack
   installClusterOperator(NAMESPACE);       <--- install cluster operator
}
```

### Exercise phase
In this phase we prepare our component, which is to be tested. In our case it is set of operations that modify the state of our
components, for instance updating configuration of `Kafka` or `KafkaConnect`, creating new listeners in the `Kafka` CR, and so on.

### Verify phase

When our environment is ready from the previous phase, then we need verify tested component(s).
This usually involves checking the component's state (possibly via the `status` section of the CR), and also verifying other observable outcomes (for example that messages were send and received).

In the following typical code snippet, we verify that configuration of the Kafka custom resource and a specific property inside Kafka pod is correctly and successfully set.

```
@TestFactory
Iterator<DynamicTest> testDynConfiguration() {

    List<DynamicTest> dynamicTests = new ArrayList<>(40);

    Map<String, Object> testCases = generateTestCases(TestKafkaVersion.getKafkaVersionsInMap().get(Environment.ST_KAFKA_VERSION).version());

    testCases.forEach((key, value) -> dynamicTests.add(DynamicTest.dynamicTest("Test " + key + "->" + value, () -> {
        // exercise phase
        KafkaUtils.updateConfigurationWithStabilityWait(CLUSTER_NAME, key, value);

        // verify phase
        assertThat(KafkaUtils.verifyCrDynamicConfiguration(CLUSTER_NAME, key, value), is(true));
        assertThat(KafkaUtils.verifyPodDynamicConfiguration(KafkaResources.kafkaStatefulSetName(CLUSTER_NAME), key, value), is(true));
    })));
    return dynamicTests.iterator();
}
```

It is worth to mention, that our tests occasionally do chain Exercise and Verify phases, so that tests can look like:

0. Exercise (modification of component state)
0. Verify (verification of component state)
0. Exercise (another modification of component state)
0. Verify (another verification modification of component state)
0. and more...

### Teardown phase

Because we have two stacks for storing resources, cluster resources deletion can be easily performed in `@AfterEach` or `@AfterAll` methods.
Resource lifecycle implementation will ensure that all resources tied to a specific stack will be deleted in the correct order.
Teardown is triggered in `@AfterAll` of `AbstractST`:
```
@AfterAll
void teardownEnvironmentClass() {
    if (Environment.SKIP_TEARDOWN == null) {
        tearDownEnvironmentAfterAll();
        teardownEnvForOperator();
    }
}
```

If you want to change teardown from your `@AfterAll`, you must override method `tearDownEnvironmentAfterAll()`:
```
@Override
protected void tearDownEnvironmentAfterAll() {
    doSomethingYouNeed();
    super.tearDownEnvironmentAfterAll();
}
```

In order to delete all resources from specific `Resources` instance, execute:
```
ResourceManager.deleteMethodResources();
ResourceManager.deleteClassResources();
```

## Resources

Resources are in our case an abstraction of the `.yaml` definitions of custom resources provided by Strimzi, such as 
`Kafka`, `KafkaTopic`, `KafkaUser`, `KafkaConnect`, `KafkaMirrorMaker` and so on.
These custom resources are represented as Java objects. 
This yaml representation of a `KafkaTopic`

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaTopic
metadata:
  name: my-topic
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 1
  replicas: 1
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
```

can be also be represented as the following Java code:

```
KafkaTopic kafkaTopic = getKafkaTopicFromYaml(PATH_TO_KAFKA_TOPIC_CONFIG); 
// additional changes...
kafkaTopic = new KafkaTopicBuilder(kafkaTopic)
    .withNewMetadata()
        .withName(topicName)
        .withNamespace(ResourceManager.kubeClient().getNamespace())
        .addToLabels(Labels.STRIMZI_CLUSTER_LABEL, clusterName)
    .endMetadata()
    .editSpec()
        .withPartitions(partitions)
        .withReplicas(replicas)
        .addToConfig("retention.ms", retentionMs)
        .addToConfig("segment.bytes", segmentBytes)
    .endSpec();
```

Everything is built within [three stacks](https://github.com/strimzi/strimzi-kafka-operator/blob/master/systemtest/src/main/java/io/strimzi/systemtest/resources/ResourceManager.java#L77-L79). 
These three stacks are managed by `ResourceManager`, which is taking care of switching. 
The method stack holds all the resources needed for each the test case. 
It gets cleaned up after each `@Test` method execution.
The class stack holds all the resources for the text fixture.
These are prepared before the test, using the `@BeforeAll`-annotated methods.
The third stack is used as a reference to either of the other two stacks to delete the resources in specific test phases.
This stack points to the class stack when we are in the `@BeforeAll` scope, otherwise we are working with the method stack.

The logic inside these stacks are that once you create some resource (for instance a `KafkaTopic`),
it will be pushed inside the stack and the deletion of topic will be performed in the teardown phase. 
Once the teardown phase is initiated, the method stack will pop all resources after test case is over. 
The same logic applies with the class stack, which pops and deletes resources when test suite is over. 
By setting the `SKIP_TEARDOWN` environment variable to `TRUE` it will skip the teardown
phase and all created resources will remain in the stack. This can be very useful for debugging purposes.

## Auxiliary classes

In system tests there are many helper classes, each having a different purpose:

0. `Utils`
0. `Constants`
0. `Environment`
0. Kubernetes client
0. Kafka clients

#### `Utils` classes

We have separate utils for each resource. 
For example, we have `KafkaUtils` for `Kafka` resource, `KafkaTopic` for KafkaResource and so on. Furthermore, we have a number of
Kubernetes-related utils such as `ServiceUtils`, `PodUtils`, `DeploymentsUtils` and so on.
These classes come handy when you have to wait for some change (e.g. wait for a `Pod` to become ready) or create, change or delete a Kubernetes resource.

The one method which stands out is `waitFor`, which is used in many Utils methods.
You can imagine the scenario, where you change a custom resource and then you want to assert the outcome is correct. 
In this scenario, if we didn't `waitFor()` the outcome to become correct, the assertion would execute too quickly and the verification would fail. 
In other cases we the operator needs to perform a rolling update, which takes time, so the test needs to wait until all pods have been restarted.
`waitFor()` simply polls for a successful condition (represented as the `BooleanSupplier` parameter) every `pollIntervalMs` for up to `timeoutMs`.
If the condition is true the method will successfully end. Otherwise, when the condition never became true within the timeout a
`WaitException` is thrown with some helpful description. The method implementation can be found [here](https://github.com/strimzi/strimzi-kafka-operator/blob/master/test/src/main/java/io/strimzi/test/TestUtils.java#L115-L145).

#### Constants

Purpose of this class is to keep global constants used across the system tests in one place. 
You can find there mentioned constants like timeout interval and poll interval used by `waitFor()` method. 
Also, there are various other timeouts for cluster operator and clients, definitions of specific ports such as `KafkaBridge` metric, 
`TopicOperator` metric, `Keycloak` and so on. 
Lastly, there are all tag names, which are used in whole system tests, for instance `ACCEPTANCE`, `REGRESSION` and more (as discussed in the previous blog post).

#### Environment

System tests can be configured by several parameters, which are loaded before test execution.

These parameters can be defined either via environmental variables or a configuration file. This file can be located anywhere on the file system as long as a path is provided to this file.
The path is defined by environment variable `ST_CONFIG_PATH`. If it is not defined, the default configuration file located in `systemtest/config.json` will be used.
Loading of system configuration has the following priority order:
0. Environment variable
0. Variable defined in configuration file
0. Default value

Some of the important parameters include:
0. `DOCKER_ORG`: Specifies the organization/repo containing the image used in system tests (default value `strimzi`)
0. `DOCKER_TAG`: Specifies the image tags used in system tests (default value `latest`)
0. `SKIP_TEARDOWN`: Skip teardown phase - primarily used for debug purposes (default value `false`)
0. `ST_KAFKA_VERSION`:  Specifies Kafka version used in images during the system tests (default value `2.6.0`)

You can see the full list [here](https://github.com/strimzi/strimzi-kafka-operator/blob/master/development-docs/TESTING.md#environment-variables)

#### Our Kafka clients

We have three different types of client for testing Strimzi:

0. For internal communication within Kubernetes - client-examples image
0. For external communication within Kubernetes - using [Vert.x](https://vertx.io/) client
0. For internal communication within Kubernetes - using test-client image (deprecated)

##### Internal using client-examples image

Internal clients are based on the Strimzi [`client-examples`](https://github.com/strimzi/client-examples) images.
This type of client is used as a Kubernetes `Job`.
For instance we can create a `Job` to send some messages to a Kafka cluster using the following code:

```
KubernetesResource.deployNewJob(new JobBuilder()
    .withNewMetadata()
        .withNamespace(ResourceManager.kubeClient().getNamespace())
        .withLabels(producerLabels)
        .withName(producerName)
    .endMetadata()
    .withNewSpec()
        .withNewTemplate()
            .withNewMetadata()
                .withLabels(producerLabels)
            .endMetadata()
            .withNewSpec()
                .withRestartPolicy("OnFailure")
                .withContainers()
                    .addNewContainer()
                    .withName(producerName)
                        .withImage("strimzi/hello-world-producer:latest")
                            .addNewEnv()
                                .withName("BOOTSTRAP_SERVERS")
                                .withValue(bootstrapServer)
                            .endEnv()
                            .addNewEnv()
                                .withName("TOPIC")
                                .withValue(topicName)
                            .endEnv()
                            .addNewEnv()
                                .withName("DELAY_MS")
                                .withValue("1000")
                            .endEnv()
                            .addNewEnv()
                                .withName("LOG_LEVEL")
                                .withValue("DEBUG")
                            .endEnv()
                            .addNewEnv()
                                .withName("MESSAGE_COUNT")
                                .withValue(String.valueOf(messageCount))
                            .endEnv()
                            .addNewEnv()
                                .withName("PRODUCER_ACKS")
                                .withValue("all")
                            .endEnv()
                            .addNewEnv()
                                .withName("ADDITIONAL_CONFIG")
                                .withValue(additionalConfig)
                            .endEnv()
                    .endContainer()
                .endSpec()
            .endTemplate()
        .endSpec()
        .build());
```

##### External using Vert.x client

External clients are implemented using Vertx.io Verticles. This type of client has the most limitations for usage.
Because this runs in the same virtual machine as the tests, it needs the Kafka cluster to have an external listener.
This introduces a platform dependency, meaning it needs things such as Loadbalancers, Nodeports, Ingresses and so on.
Nodeports and Loadbalancers can be very complex to configure on some infrastructures.
We have `Oauth`, `Tracing` and also `Basic` clients which are based on this client and each of them are for specific use case.

However, usage of the internal clients is often preferred if possible as it reduces the platform dependency, so tests can be executed on different infrastructure.

Here's an example of how we configure a basic vertx test client:

```
// 1. Creating the client instance 

BasicExternalKafkaClient basicExternalKafkaClient = new BasicExternalKafkaClient.Builder()
    .withTopicName("topic-name")
    .withNamespaceName("namespace-name")
    .withClusterName("cluster-name")
    .withKafkaUsername("kafka-username")
    .withMessageCount(100)
    .withSecurityProtocol(SecurityProtocol.SSL)
    .build();

// 2. Sending messages

basicExternalKafkaClient.sendMesssageTls();
```

## Dependencies

The system tests have two dependencies on other Strimzi modules:

0. test (kubernetes client)
0. crd-generator + api (chaining / builder pattern)

### Test module

The test module defines the Kubernetes client, which we use in the system tests to create, list, delete and update 
Kubernetes resources such as `Service`, `Deployment`, `Pod`, `ConfigMap` and so on. 
Basically, we encapsulate the [Kubernetes client](https://github.com/fabric8io/kubernetes-client) from fabric8 to use 
client more handy with no additional and typically redundant method chaining. 
Moreover, we have an abstraction of a Kubernetes cluster and a mechanism for detecting which type of Kubernetes cluster the test is using 
(Kubernetes, Minikube and so on).

Lastly, in this module you can also find the [Command Client](https://github.com/strimzi/strimzi-kafka-operator/tree/master/test/src/main/java/io/strimzi/test/k8s/cmdClient), which can ue useful for executing certain commands via `kubectl`, for example `kubectl annotate...`, `kubectl exec...` and so on.

### Api module

The Resources previously described in Resource section are defined in the crd-generator and api modules.
Each time when the code of those modules changes, you have to rebuild them to generate new schema for resources.
For instance, imagine that you are using `Kafka` resource and you need to create Kafka with the `Cruise Control` support but you have old schemas, which do not support it.
You will need to build these modules and generate schema, which will support it and be able to create Kafka with Cruise Control.
These modules provide the fluent way of creating Strimzi custom resource instances such as `Kafka`, `KafkaConnect`, `KafkaConnectS2I`, `KafkaMirrorMaker` and many other.

## How to create a system test

At this point you have the necessary knowledge to create a simple test. There are also some additional steps, which need to be performed to set up your testing environment.

### Prerequisites

0. Fork the [strimzi-kafka-operator](https://github.com/strimzi/strimzi-kafka-operator) repository.
0. Build the whole project in the root directory - `mvn clean install -DskipTests` or you can use `mvn -am clean install -DskipTests -f systemtest/pom.xml`.
0. Setup your Kubernetes cluster.
0. Login to your Kubernetes cluster as a user who has rights to install the Strimzi operator.
0. To verify that things are working, try to run some of the existing system tests, for instance `io.strimzi.systemtest.bridge.HttpBridgeST.testSendMessagesTlsAuthenticated()` (which takes around 5 minutes to run).

### Writing new test case

We are going to create a very simple test using the aforementioned classes like `Resources`, `Utils`, `Kubernetes client` and so on.

Let's implement a test case that verifies:

0. Kafka cluster was successfully deployed.
0. Clients are able to send and receive messages to that Kafka cluster.

The test scenario could look like this:

0. Setup & Exercise:  Deploy Strimzi Operator.
0. Setup & Exercise:  Deploy a `Kafka` cluster with 3 kafka nodes and 3 zookeeper nodes.
0. Verify: Verify that `Kafka` is ready.
0. Setup & Exercise: Create instance of `Kafka clients`.
0. Exercise: Send messages to `Kafka` cluster.
0. Exercise: Receive messages from `Kafka` cluster.
0. Verify: Verify that we have sent and received expected count of messages.
0. Teardown : Clean up all resources (this phase is implicitly done in AbstractST).

The teardown phase is performed automatically by system tests mechanism, so there is no need to take care of it in our code.

The test case can look like this:

```java
package io.strimzi.systemtest;

import io.strimzi.systemtest.kafkaclients.internalClients.InternalKafkaClient;
import io.strimzi.systemtest.resources.ResourceManager;
import io.strimzi.systemtest.resources.crd.KafkaClientsResource;
import io.strimzi.systemtest.resources.crd.KafkaResource;
import io.strimzi.systemtest.utils.kafkaUtils.KafkaUtils;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

public class MyTestSuite extends AbstractST {

    private static final String NAMESPACE = "my-test-suite-namespace";
    private static final Logger LOGGER = LogManager.getLogger(MyTestSuite.class);

    @BeforeAll
    void setup() throws Exception {
        ResourceManager.setClassResources();
        installClusterOperator(NAMESPACE); //  <-- 1st step
    }

    @Test
    @Tag(INTERNAL_CLIENTS_USED)
    void myFirstTestCase() {

        int kafkaReplicas = 3;
        int zookeeperReplicas = 3;

        LOGGER.info("Deploying Kafka cluster {} with {} kafka nodes and {} zookeeper nodes", CLUSTER_NAME, kafkaReplicas, zookeeperReplicas);

        KafkaResource.kafkaEphemeral(CLUSTER_NAME, kafkaReplicas, zookeeperReplicas).done(); // <-- 2nd step

        KafkaUtils.waitForKafkaReady(CLUSTER_NAME); // <-- 3rd step

        // here we can decide which client can we use, as we said we prefer the InternalClients so i will use that one.

        // ============
        // 4th step start
        KafkaClientsResource.deployKafkaClients(false, CLUSTER_NAME + "-" + Constants.KAFKA_CLIENTS).done();
        String defaultKafkaClientsPodName =
            ResourceManager.kubeClient().listPodsByPrefixInName(CLUSTER_NAME + "-" + Constants.KAFKA_CLIENTS).get(0).getMetadata().getName();

        InternalKafkaClient internalKafkaClient = new InternalKafkaClient.Builder()
            .withUsingPodName(defaultKafkaClientsPodName)
            .withTopicName(TOPIC_NAME)
            .withNamespaceName(NAMESPACE)
            .withClusterName(CLUSTER_NAME)
            .withMessageCount(MESSAGE_COUNT)
            .build();

        // 4th step ends
        // ============

        LOGGER.info("Checking produced and consumed messages to pod:{}", defaultKafkaClientsPodName);

        internalKafkaClient.checkProducedAndConsumedMessages(  // <-- 7th step
            internalKafkaClient.sendMessagesPlain(),   // <-- 5th step
            internalKafkaClient.receiveMessagesPlain() // <-- 6th step
        );
    }
}

```

Congratulations you have written your first new test case in Strimzi system tests!

## Conclusion

The system test code can, at first glance, be hard to understand, but with perseverance and an understanding of the classes used by the system tests, it's not so difficult to get started.
As always, we are open to any discussions and suggestions to help enhance our testing.
