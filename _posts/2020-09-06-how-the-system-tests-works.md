---
layout: post
title:  "How system tests works"
date: 2020-09-06
author: maros_orsak
---
In [previous blog post](https://strimzi.io/blog/2020/09/21/introduction-to-system-tests/) related on testing we learned 
about our unit tests, integration tests and how they differ from system tests. 
Furthermore, we showed up how to run them on Kubernetes cluster. 
But, we did not cover whole understanding of the system tests. 
In this blog post we will take a closer look at our system tests. The content is as follows:

# Content
1. [Introduction](#Introduction)
2. [Resources](#Resources)
3. [Lifecycle of tests](#Lifecycle of tests)
4. [Auxiliary classes](#Auxiliary classes)
5. [Dependencies](#Dependencies)
6. [How to create a system test](#How to create a system test)
8. [Conclusion](#Conclusion)

## Introduction

The whole ecosystem behind systems test is encapsulated in two mandatory things. 
First the `Resources`, creates the whole testing environment. 
Second - the auxiliary classes, which are divided into the classic static methods `Utils`, internal clients, 
`Apache Kafka Clients` for the external communication, Kubernetes client, `Constants.java` and `Environment.java`.
Main idea is to make the system tests and its resources easily modifiable and writable in the fluent way. Let's have a closer
to our resources.

## Resources

Resources in our mean of usage are abstractions of the `.yaml` definitions of custom resources, which we provide, such as 
`Kafka`, `KafkaTopic`, `KafkaUser`, `KafkaConnect`, `KafkaMirrorMaker` and so on.
These custom resources are encapsulated into java objects and remind the [ORM(Object Relation Mapping)](https://www.tutorialspoint.com/hibernate/orm_overview.htm) 
from databases. 
In the following yaml code [2.1](#kafkatopic) we can see YAML representation of `KafkaTopic` and on the Code snippet 
[2.2](kafkaimplementation) related java object.

##### <a id="kafkatopic">Code snippet 2.1 YAML representation of `KafkaTopic`</a>
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

##### <a id="kafkaimplementation">Code snippet 2.2 Loading of the YAML file to JAVA representation object.</a>
```java
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
        .addToConfig("min.insync.replicas", minIsr)
    .endSpec();
```

Everything is built within [three stacks](https://github.com/strimzi/strimzi-kafka-operator/blob/master/systemtest/src/main/java/io/strimzi/systemtest/resources/ResourceManager.java#L77-L79). 
These three stacks are managed by `ResourceManager`, which is taking care of switching. 
First one's, method stack, responsibility is to hold all resources, which are invoked in the test cases. 
Second one's, the class stack, responsibility is to hold all resources, which are invoked in the `@BeforeAll` notation. 
The third stack is used as a pointer to either class or method stack to delete proper resources in specific test phases.
The pointer stack points to the class stack in we are in the `@BeforeAll` scope, otherwise we are working with the method stack. 
The logic inside these stacks are that once you create some resource (for instance KafkaTopic),
it will be pushed inside the stack and the deletion of topic will be performed in the teardown phase. 
Once the teardown phase is initiated, the method stack will pop all resources after test case is over. 
The same logic applies with class stack, which will pop all resources when test suite is over. 
What is worth to mention, is that if you specify `SKIP_TEARDOWN` environment variable to `TRUE` it will skip the teardown 
phase and all created resources will remain in the stack. Also, mostly great for debugging because it could break tests 
if it's set for multiple than one.

## Lifecycle of tests

Like any other test life cycle, we follow the [SEVT](http://xunitpatterns.com/Four%20Phase%20Test.html) convention. 
[SEVT](http://xunitpatterns.com/Four%20Phase%20Test.html) stands for Setup, Exercise, Verify and Teardown.

### Setup

In `Setup phase` we perform following actions:

* Create namespace(s)
* Deploy the Strimzi Cluster operator
* Deploy the Kafka cluster and/or other components (optional)

The reason why the last point is optional, is because we have some test cases where we might want to have a different kafka 
configuration for each test scenario, so creation of the Kafka cluster and other resources is done in the test phase.

We create resources in Kubernetes cluster via classes in `resources` package, which allows you to deploy all components and, 
if needed, change theirs default configuration using a builder.
Currently, we have three stacks, which are stored in `ResourceManager` singleton instance — one for all test class resources, 
one for test method resources and one auxiliary, which always points to class or method stack.
You are allowed to create resources during execution of any test method. 
Resource lifecycle implementation handles insertion of the resource on top of the stack and its deletion at the end of the test method/class (teardown phase).

`ResourceManager` stores info, which stack is currently active (class or method) in the `pointer stack`.
You can change between class and method resources stack with method `ResourceManager.setMethodResources()` or `ResourceManager.setClassResources()`.
Note that pointer stack is set automatically in `AbstractST.class` in `@BeforeAll` or `@BeforeEach` methods.

Cluster Operator setup example:
```java
    @BeforeAll
    void createClassResources() {
        prepareEnvForOperator(NAMESPACE);                          <--- Create namespaces
        createTestClassResources();                                <--- Create Resources instance for class
        applyRoleBindings(NAMESPACE);                              <--- Apply Cluster Operator bindings
        KubernetesResource.clusterOperator(NAMESPACE).done();      <--- Deploy Cluster Operator
        ...
    }
```

### Exercise
In this phase we specify all steps which need to be executed to cover some specific functionality. Reasonable example would be
the Code snippet 1.4 from previous section, where we setup Kafka cluster with new persistent claim storage.

### Verify

When your environment is successfully deployed and settled from the previous phase, you can add code for some checks, message exchange, etc.
In this code snippet you can see verification phase, where we verify that configuration of the Kafka custom resource is successfully set.
Moreover, we verify that specific property is correctly set inside Kafka pod.

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

### Teardown

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

so if you want to change teardown from your `@AfterAll`, you must override method `tearDownEnvironmentAfterAll()`:
```java
    @Override
    protected void tearDownEnvironmentAfterAll() {
        doSomethingYouNeed();
        super.tearDownEnvironmentAfterAll();
    }
```

In order to delete all resources from specific `Resources` instance, execute:
```java
    ResourceManager.deleteMethodResources();
    ResourceManager.deleteClassResources();
```

## Auxiliary classes

In `system test` module there are many helper classes,  each having a different purpose:

1. Utils
2. Constants
3. Environment
4. Kubernetes client
5. Kafka clients

#### Utils

These classes are applicable on many problems. We have separate utils for each resource. 
For instance we have KafkaUtils for KafkaResource, KafkaTopic for KafkaResource and so on. Furthermore, we have got
Kubernetes related utils such as ServiceUtils, PodUtils, DeploymentsUtils and many more.
These classes come handy for instance when you have to wait for some change, make some API call, create, change or delete a Kubernetes resource and much more.
The one method which stands out is `waitFor`, which is used in many utils methods.
You can imagine the scenario, where you will change some custom resource value of Kafka and then you will want to assert
that this value was correctly updated. This is a very good example where `race condition` comes into play. This race condition
can occur if the assertion (verify phase) is too quick and value has not been updated. That is the reason why we have this dynamic `waitFor()` function. The logic behind this method is that every `pollIntervalMs` for specific period of time `timeoutMs` the method checks
`BooleanSupplier` condition which user can provide and if this condition is true the method will successfully end. Otherwise, we will get the
`WaitException` with some reasonable description. The method implementation can be found [here](https://github.com/strimzi/strimzi-kafka-operator/blob/master/test/src/main/java/io/strimzi/test/TestUtils.java#L115-L145).

#### Constants

Purpose of this class is to keep global constants used across system tests in one place. You can find there mentioned constants like timeout interval and poll interval used by `waitFor()` method. Also, there are various other timeouts for cluster operator and clients, definitions of specific ports such as KafkaBridge metric, TopicOperator metric, Keycloak and so on. Lastly, there are all tag names,
which are used in whole `system test` module, for instance `ACCEPTANCE`, `REGRESSION` and more.
 
#### Environment

System tests can be configured by several environment variables, which are loaded before test execution.

Variables can be defined via environmental variables or a configuration file. This file can be located anywhere on the file system as long as a path is provided to this file.
The path is defined by environment variable `ST_CONFIG_PATH`. If it is not defined, the default config file location `systemtest/config.json` will be used instead.
Loading of system configuration has the following priority order:
1. Environment variable
2. Variable defined in configuration file
3. Default value

Here is the list of important environment variables:

1. `DOCKER_ORG` = Specifies the organization/repo containing the image used in system tests (default value `strimzi`)
2. `DOCKER_TAG` = Specifies the image tags used in system tests (default value `latest`)
3. `SKIP_TEARDOWN` = Skip teardown phase - primarily used for debug purposes (default value `false`)
4. `ST_KAFKA_VERSION` =  Specifies Kafka version used in images during the system tests (default value `2.6.0`)

If you want to see all our environment variables you can see it [here](https://github.com/strimzi/strimzi-kafka-operator/blob/master/development-docs/TESTING.md#environment-variables)

#### Our Kafka clients

Another helpful module of the system tests are Kafka clients, which contains three usage types:

1. For internal communication within Kubernetes - using test-client image
2. For internal communication within Kubernetes - client-examples image
3. For external communication within Kubernetes - using Vert.x client

##### Internal using test-client image

The first client using the our image. Basically, it is defined as a deployment and inside the container, we start the 
`kafka-verifiable-(consumer|producer).sh` shell script. In case of more interest you can [here](https://github.com/strimzi/strimzi-kafka-operator/tree/release-0.20.x/docker-images/test-client).
The usage of this client is straightforward as it is implemented by Builder pattern, which was previously mentioned. 
For instance, creating some producer or consumer can easily be done as:

```java
// 1. Creating the client instance 

InternalKafkaClient internalKafkaClient = new InternalKafkaClient.Builder()
    .withUsingPodName("kafka-client-pod")
    .withTopicName("topic-name")
    .withNamespaceName("namespace-name")
    .withClusterName("cluster-name")
    .withMessageCount(100)
    .build();

// 2. Sending messages by interface method

internalKafkaClient.sendMessagesPlain();  // <- for plain communication
```

Note, that before sending messages to the Kafka cluster we need to ensure that test-client pod is running. This can be done via following code line, which basically creates the pod,
in which resides running test-client and waiting for commands invoked by `kafka-verifiable-(consumer|producer).sh`.

```java
KafkaClientsResource.deployKafkaClients(false, CLUSTER_NAME + "-" + Constants.KAFKA_CLIENTS).done();
```

##### Internal using client-examples image

The second one is based on client-examples images, where everything about client implementation with also `Dockerfiles`
can be found [here](https://github.com/strimzi/client-examples).
This type of client is used as Job. For instance to send some messages provide following code:

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

Lastly, external clients are implemented by supporting Vertx.io Verticles. This type of client has the most limitations for usage. Most notable is dependency on external listeners, which is caused by`platform dependency`. 
They are implemented by _Abstract recursive builder, which makes these clients very handful. 
What is worth mentioning is that external clients are running in same environment as your tests.
Moreover, we have `Oauth`, `Tracing` and also `Basic` client. Each of them are for specific use case. 
However, we prefer to always use the internal clients because of mentioned platform dependency. 
Client can be used for instance:

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

Before writing simple test case in Strimzi system tests, we need to know main dependencies that `system test` module has. 
The most important ones are:
1. test (kubernetes client)
2. crd-generator + api (chaining / builder pattern)

### test module

In the test module, we have the Kubernetes client, which we use in the system tests to create, list, delete and update 
Kubernetes resources such as Service, Deployment, Pod, ConfigMap and so on. 
Basically, we encapsulate the [Kubernetes client](https://github.com/fabric8io/kubernetes-client) from fabric8 to use 
client more handy with not additional and typically redundant method chaining. 
Moreover, we have our abstraction of Kubernetes cluster and mechanism to detect on which type is currently client. 
Clusters could be Kubernetes, Minikube and so on.
Lastly, in this module you can find [Command Client](https://github.com/strimzi/strimzi-kafka-operator/tree/master/test/src/main/java/io/strimzi/test/k8s/cmdClient),
which servers as executor and can invoke various requests such as `kubectl annotate...`, `kubectl exec...` and so on.

### crd-generator + api module

Resources previously described in Resource section are used in crd-generator and api modules.
Every time, when the code of Model changes you have to build the whole modules to generate new schema for resources. 
For instance, imagine that you are using `Kafka` resource and you need to create Kafka with the `Cruise Control` support but you have old schemas, which does not support it.
You will need to build these modules and generate schema, which will support it and be able to create Kafka with Cruise Control. 
These modules provide the fluent way of creating Strimzi custom resource instances such as `Kafka`, `KafkaConnect`, `KafkaConnectS2I`, `KafkaMirrorMaker` and many other.

## How to create a system test

At this point you have the necessary knowledge to create a simple test. There are also some additional steps, which need to be performed to set up your testing environment.

### Precursors

1. Fork the `strimzi-kafka-operator` repository - https://github.com/strimzi/strimzi-kafka-operator
2. Build the whole project in root directory - `mvn clean install -DskipTests` or you can use `mvn -am clean install -DskipTests -f systemtest/pom.xml`
3. Setup your Kubernetes cluster
4. Login to your Kubernetes cluster
5. Try to start some of our tests inside `system test` module for instance - `io.strimzi.systemtest.bridge.HttpBridgeST.testSendMessagesTlsAuthenticated()` 
(test takes around 5 minutes)

### Writing new test case

We are going to create a very simple test using aforementioned classes like `Resources`, `Utils`, `Kubernetes client` and so on.

Description of the test case: 

1. Verify that Kafka was successfully deployed
2. Clients are able to send and receive messages to Kafka cluster
 
As you can see, we have two main things to take care of. First is `verify that Kafka was correctly deployed` and the second one is `clients can send messages to and receive messages from Kafka cluster`.

Test scenario could look like this:

1. Deploy Strimzi Operator <- setup + exercise
2. Deploy `Kafka` cluster with 3 kafka nodes and 3 zookeeper nodes <- setup + exercise
3. Verify that `Kafka` is ready <- verify
4. Create instance of `Kafka clients` <- setup + exercise
5. Send messages to `Kafka` cluster <- exercise
6. Receive messages from `Kafka` cluster <- exercise
7. Verify that we have sent and received expected count of messages <-verify
8. Clean up all resources (this phase is implicitly done in AbstractST) <- teardown

Note, that teardown phase is performed automatically by system tests mechanism so there is no need to take care of it by user in code.

Test case then can look like this:

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

    @Test
    void myFirstTestCase() {

        int kafkaReplicas = 3;
        int zookeeperReplicas = 3;

        LOGGER.info("Deploying Kafka cluster {} with {} kafka nodes and {} zookeeper nodes", CLUSTER_NAME, kafkaReplicas, zookeeperReplicas);

        KafkaResource.kafkaEphemeral(CLUSTER_NAME, kafkaReplicas, zookeeperReplicas).done(); // <-- 2.point

        KafkaUtils.waitForKafkaReady(CLUSTER_NAME); // <-- 3.point

        // here we can decide which client can we use, as we said we prefer the InternalClients so i will use that one.

        // ============
        // 4.point start
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

        // 4.point ends
        // ============

        LOGGER.info("Checking produced and consumed messages to pod:{}", defaultKafkaClientsPodName);

        internalKafkaClient.checkProducedAndConsumedMessages(  // <-- 7.point
            internalKafkaClient.sendMessagesPlain(),   // <-- 5.point
            internalKafkaClient.receiveMessagesPlain() // <-- 6.point
        );
    }

    @BeforeAll
    void setup() throws Exception {
        ResourceManager.setClassResources();
        installClusterOperator(NAMESPACE); //  <-- 1.point
    }
}

```

Congratulations you have written your new test case in Strimzi `system test` module!

## Conclusion

The whole ecosystem of system tests is at first glance hard to understand but if the person who is learning this domain has a drive, it won't be a challenge for him. 
Whole module went through several iterations of evolution, which improved many areas.
We are open to any discussion and suggestions, which can enhance the overall behavior to robust, better way of testing.
Maybe You will be the one who will change the structure of system tests and make it even better!
