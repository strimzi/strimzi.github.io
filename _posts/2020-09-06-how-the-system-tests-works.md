---
layout: post
title:  "How system tests work"
date: 2020-09-06
author: maros_orsak
---
In the [previous blog post related to testing](https://strimzi.io/blog/2020/09/21/introduction-to-system-tests/) we learned 
about our unit tests and integration tests and how they differ from system tests. 
Furthermore, we showed how you can run them on a Kubernetes cluster. 
But, we did not cover the system tests themselves in any great detail.
So in this blog post we will take a closer look at our these tests.
This post will be useful for anyone wanting to contribute to the tests and assumes some familiarity with Java.

## Introduction

Our system tests rely on two mandatory things.
* The `Resources` class, which is responsible for creating the testing environment.
* Auxiliary classes, which are divided into the classic `Utils` - style static methods, internal clients,
the Apache Kafka Clients for the external communication, Kubernetes client, `Constants.java` and `Environment.java`.

Main idea is to make the system test and its resources easily modifiable and writable in the [fluent way](https://en.wikipedia.org/wiki/Fluent_interface). Before, we dive into the `Resources` class, we need to understand the lifecycle of the system tests. 

## Lifecycle of tests

Like any other test lifecycle, we follow the [SEVT](http://xunitpatterns.com/Four%20Phase%20Test.html) convention. 
SEVT stands for Setup, Exercise, Verify and Teardown.

### The Setup phase

In the Setup phase we perform the following actions:

* Create some namespace(s)
* Deploy the Strimzi Cluster operator
* Deploy a Kafka cluster and/or other components (optional)

In some test cases, we have a different kafka configuration for each test scenario. 
In other test cases we share a single Kafka cluster between tests. 
The former kind of test has better test isolation and is needed when a test case needs a specific configuration of Kafka cluster. 
For these tests the creation of the Kafka cluster and other resources is done in the test phase.
The latter kind of test has worse test isolation, but does result in a speed up in test execution.

We create resources in the Kubernetes cluster using the classes in the `resources` package, which allows us to deploy all the components and, 
if needed, change their default configurations using the builder pattern.
We do this using three stacks, stored in the `ResourceManager` singleton instance. 
When we create a resource, we push it onto the relevant stack, so that we can clean up the resource at the end of the test (teardown phase). 
We have one stack for all test class resources, one for test method resources and one auxiliary, which always points to the class or method stack.
This allows us to create resources during the execution of any test method. 

`ResourceManager` controls which stack the 'auxiliary stack' reference is referring to.
You can change between class and method resources stack with method `ResourceManager.setMethodResources()` or `ResourceManager.setClassResources()`.
Note that auxillary stack is set automatically in `AbstractST.class` in `@BeforeAll` or `@BeforeEach` methods.

Cluster Operator setup example:

```java
@BeforeAll
void createClassResources() {
   ResourceManager.setClassResources(); // resource manager uses the class stack
   installClusterOperator(NAMESPACE);   // install cluster operator into NAMESPACE
}
```

### The Exercise phase
In this phase we prepare our component, which is to be tested.
In our case it is set of operations that modify the state of our
components, for instance updating the configuration of `Kafka` or `KafkaConnect`, creating new listeners in the `Kafka` CR, and so on.

### The Verify phase

When our environment is ready from the previous phase, then we need verify tested component(s).
This usually involves checking the component's state (possibly via the `status` section of the CR), and also verifying other observable outcomes (for example that messages were sent and received).

In the following typical code snippet, we verify that configuration of the Kafka custom resource and a specific property inside the Kafka pod is correctly set.

```java
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

It is worth mentioning, that our tests occasionally do chain Exercise and Verify phases, so that tests can look like:

0. Exercise (modification of component state)
0. Verify (verification of component state)
0. Exercise (another modification of component state)
0. Verify (another verification modification of component state)
0. and more...

### Teardown phase

Because we have two stacks for storing resources, cluster resources deletion can be easily performed in `@AfterEach` or `@AfterAll` methods.
Resource lifecycle implementation will ensure that all resources tied to a specific stack will be deleted in the correct order.
Teardown is triggered in `@AfterAll` of `AbstractST`:

```java
@AfterAll
void teardownEnvironmentClass() {
    if (Environment.SKIP_TEARDOWN == null) {
        tearDownEnvironmentAfterAll();
        teardownEnvForOperator();
    }
}
```

If you want to change teardown from your `@AfterAll`, you must override the `tearDownEnvironmentAfterAll()` method:

```java
@Override
protected void tearDownEnvironmentAfterAll() {
    doSomethingYouNeed();
    super.tearDownEnvironmentAfterAll();
}
```

In order to delete _all_ the resources from a specific `Resources` instance, execute:

```java
ResourceManager.deleteMethodResources();
ResourceManager.deleteClassResources();
```

## Resources

Resources are an abstraction of the `.yaml` definitions of custom resources provided by Strimzi and Kubernetes, such as 
`Kafka`, `KafkaTopic`, `KafkaUser`, `KafkaConnect`, `KafkaMirrorMaker` and so on.
In the tests such resources are represented as Java objects. 
This YAML representation of a `KafkaTopic`

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

can be represented as the following Java code:

```java
// start from a KafkaTopic read from YAML...
KafkaTopic kafkaTopic = getKafkaTopicFromYaml(PATH_TO_KAFKA_TOPIC_CONFIG); 
// ... make additional changes...
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

Everything is built using the [three stacks](https://github.com/strimzi/strimzi-kafka-operator/blob/master/systemtest/src/main/java/io/strimzi/systemtest/resources/ResourceManager.java#L77-L79) managed by `ResourceManager`, which takes care of the switching. 
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
By setting the `SKIP_TEARDOWN` environment variable to `TRUE` it will skip the teardown phase and all created resources will remain in the stack.
This can be very useful for debugging purposes.

## Auxiliary classes

In system tests there are many helper classes, each having a different purpose:

0. `Utils`
0. `Constants`
0. `Environment`
0. The Kubernetes client
0. Kafka clients

#### `Utils` classes

We have separate utils for each resource. 
For example, we have `KafkaUtils` for `Kafka` CRs, `KafkaTopicUtils` for `KafkaTopic` CRs and so on. Furthermore, we have a number of
Kubernetes-related utils such as `ServiceUtils`, `PodUtils`, `DeploymentsUtils` and so on.
The function in these classes are handy when you have to wait for some change (e.g. wait for a `Pod` to become ready) or create, change or delete resources.

The one method which stands out is `waitFor`, which is used in many Utils methods.
You can imagine the scenario, where you change a custom resource and then you want to assert the outcome is correct. 
In this scenario, if we didn't `waitFor()` the outcome to become correct, the assertion would execute too quickly and the verification would fail. 
In other cases, the operator needs to perform a rolling update, which takes time, so the test needs to wait until all pods have been restarted.
`waitFor()` simply polls for a successful condition (represented as the `BooleanSupplier` parameter) every `pollIntervalMs` for up to `timeoutMs`.
If the condition is true the method will successfully end. Otherwise, when the condition never became true within the timeout a
`WaitException` is thrown with some helpful description.

#### Constants

Purpose of this class is to keep global constants used across the system tests in one place. 
You can find there mentioned constants like timeout interval and poll interval used by `waitFor()` method. 
Also, there are various other timeouts for cluster operator and clients, definitions of specific ports such as for `KafkaBridge` metrics, 
`TopicOperator` metrics, `Keycloak` and so on. 
Lastly, there are all the tag names, for instance `ACCEPTANCE`, `REGRESSION` and so on used to control which tests to run (as discussed in the previous blog post).

#### Environment

The System tests can be configured by several parameters, which are loaded before test execution.

These parameters can be defined either via environment variables or a configuration file. This file can be located anywhere on the file system as long as the path to this file is provided by environment variable `ST_CONFIG_PATH`.
If it is not defined, the default configuration file located in `systemtest/config.json` will be used.
The loading of system configuration has the following priority order:
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
0. For internal communication within Kubernetes - using test-client image (deprecated, and not discussed further here)

##### Internal using client-examples image

Internal clients are based on the Strimzi [`client-examples`](https://github.com/strimzi/client-examples) images.
The benefit of this client (and the reason why it's called 'internal') is it can be used when testing access to the Kafka cluster from inside the Kubernetes cluster.
This client typically runs as a Kubernetes `Job`.
For instance we can create a `Job` to send some messages to a Kafka cluster using the following code:

```java
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
                            .end type of.withName("MESSAGE_COUNT")
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

External clients are implemented using Vertx.io Verticles. 
Because this runs in the same virtual machine as the tests, it needs the Kafka cluster to have an external listener.
In other words it is limited to running against Kafka clusters exposed outside Kubernetes.
This introduces a platform dependency, meaning it needs things such as Loadbalancers, Nodeports, Ingresses and so on.
Nodeports and Loadbalancers can be very complex to configure on some infrastructures, and that complicates test execution.
We have `Oauth`, `Tracing` and also `Basic` clients which are based on this client and each of them are for specific use case.

However, usage of the internal clients is often preferred if possible as it reduces the platform dependency, so those tests can be executed across all infrastructures.

Here's an example of how we configure a basic vertx test client:

```java
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
Basically, we encapsulate the [Kubernetes client](https://github.com/fabric8io/kubernetes-client) from fabric8 to make is better suited to our usage. 
Moreover, we have an abstraction of a Kubernetes cluster and a mechanism for detecting which type of Kubernetes cluster the test is using 
(Kubernetes, Minikube and so on).

Lastly, in this module you can also find the [Command Client](https://github.com/strimzi/strimzi-kafka-operator/tree/master/test/src/main/java/io/strimzi/test/k8s/cmdClient), which can ue useful for executing certain commands via `kubectl`, for example `kubectl annotate...`, `kubectl exec...` and so on.

### Api module

The Resources previously described in Resource section are defined in the crd-generator and api modules.
Each time the code of those modules changes, you have to rebuild them to generate new schema for resources.
For instance, imagine that you are using `Kafka` resource and you need to create Kafka with the `Cruise Control` support but you have old schemas, which do not support it.
You will need to build these modules and generate schema, which will support it and be able to create a Kafka with Cruise Control.
These modules provide a fluent way of creating Strimzi custom resource instances such as `Kafka`, `KafkaConnect`, `KafkaConnectS2I`, `KafkaMirrorMaker` and many others.

## How to run a system test

At this point you have the necessary knowledge to _create_ a simple test. But there are some additional steps which need to be performed before you can _run_ the test: You need to set up your testing environment.

### Prerequisites

Having forked the [strimzi-kafka-operator](https://github.com/strimzi/strimzi-kafka-operator) repository:

0. Build the whole project in the root directory - `mvn clean install -DskipTests` or you can use `mvn -am clean install -DskipTests -f systemtest/pom.xml`.
0. Setup your Kubernetes cluster.
0. Log in to your Kubernetes cluster as a user who has rights to install the Strimzi operator (create the CRDs, `ClusterRoles` and `ClusterRollBindings` and so on).
0. To verify that things are working, try to run some of the existing system tests, for instance `io.strimzi.systemtest.bridge.HttpBridgeST.testSendMessagesTlsAuthenticated()` (which takes around 5 minutes to run).

### Writing new test case

We are going to create a very simple test using the aforementioned classes like `Resources`, `Utils`, `Kubernetes client` and so on.

Let's implement a test case that verifies:

* The Kafka cluster was successfully deployed
* Clients are able to send and receive messages to that Kafka cluster.

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

The test case could look like this:

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

Congratulations you have written your first new test case in the Strimzi system tests!

## Conclusion

The system test code can, at first glance, be hard to understand, but with perseverance and an understanding of the classes used by the system tests, it's not so difficult to get started.
As always, we are open to any discussions and suggestions to help enhance our testing.
