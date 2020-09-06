---
layout: post
title:  "How the SYSTEM TESTS works"
date: 2020-09-06
author: maroš_orsák
---

Sometimes, We underestimate strength of testing. Many companies start verification of the software product belated. The process of testing is complex as many can not imagine. It can be highlighted by quote: "If we fail, we fall. If we succeed - then we will face the next task."
Strimzi is not an exception and you have to know many technologies such as [Kubernetes](https://kubernetes.io/), [Apache Kafka](https://kafka.apache.org/),
[Keycloak](https://www.keycloak.org/), [Open Policy Agent](https://www.openpolicyagent.org/), [Cruise control](https://github.com/linkedin/cruise-control) and so on.

In this blog post we are gonna take a closer look on our system tests. The content is as follows:

# Content
1. [Introduction](#Introduction)
2. [Resources](#Resources)
3. [Lifecycle of tests](#Lifecycle of tests)
4. [Auxiliary classes](#Auxiliary classes)
5. [Dependencies](#Dependencies)
6. [How to create a system test](#How to create a system test)
8. [Conclusion](#Conclusion)

## Introduction

The whole ecosystem behind systems test is encapsulated in two mandatory things. First of all it is
the Resources, which create the whole testing environment. The second of all we have the auxiliary classes that are divided into
the classic static methods `Utils`, Clients for the external and also internal communication, `Constants.java` and `Envinroment.java`.

Pure idea to make the system tests easily modifiable is to able to write the resources in the fluent way. Fluent notation is nested builders by which you can build customized objects by your imagination.
For instance before the Fluent notation we have the [1.Telescoping pattern](https://www.vojtechruzicka.com/avoid-telescoping-constructor-pattern/#telescoping-constructor) but this does not scale well to large numbers of optional parameters.
Second alternative would be the [2.JavaBeans convention](https://www.vojtechruzicka.com/avoid-telescoping-constructor-pattern/#alternative-1---javabeans), which first of all resolve our issue from the telescoping pattern but on the
other hand the objects which we create will be mutable. Luckily, there is a third alternative that combines the safety of the telescoping constructor pattern with the readability of the JavaBeans pattern. It is a form of the [3.Builder pattern](https://refactoring.guru/design-patterns/builder).
Moreover, if we take this idea to the next level to the `4.Abstract Recursive builder` we will be able to create multiple dependent objects, which has some hierarchy. In the following figures 1.1, 1.2, 1.3 we can see described idea and you can see how easily we can create an object using Abstract Recursive builder.

####  1. Kafka with new persistent claim storage and following settings

##### Figure 1.2 Using JavaBeans convention
```
PersistentClaimStorage psc = new PersistentClaimStorage();

psc.setId(0);
psc.setSize("100Gi");
psc.setDeleteClaim(true);

KafkaResource.kafkaEphemeral(CLUSTER_NAME, 3, 1)
    .editSpec()
        .editKafka()
            .withPersistentClaimStorage(psc)
        .endKafka()
    .endSpec()
    .done();
```

##### Figure 1.3 Using Builder pattern
```
PersistentClaimStorage pcs = new PersistentClaimStorageBuilder()
    .withDeleteClaim(true)
    .withId(0)
    .withSize("100Gi")
    .build();

KafkaResource.kafkaEphemeral(CLUSTER_NAME, 3, 1)
    .editSpec()
        .editKafka()
            .withPersistentClaimStorage(psc)
        .endKafka()
    .endSpec()
    .done();
```

##### Figure 1.4 Using Abstract recursive builder
```
KafkaResource.kafkaEphemeral(CLUSTER_NAME, 3, 1)
    .editSpec()
        .editKafka()
            .withNewPersistentClaimStorage()
                .withId(0)
                .withNewSize("100Gi")
                .withDeleteClaim(true)
            .endPersistentClaimStorage()
        .endKafka()
    .endSpec()
    .done();
```

This examples was illustrated idea only one dependent you can imagine three, four and more objects, which can be changed for instance:

```
KafkaResource.kafkaEphemeral(CLUSTER_NAME, 3, 1)
    .editMetadata()
        .withName(name)
        .withNamespace(ResourceManager.kubeClient().getNamespace())
    .endMetadata()
    .editSpec()
        .editKafka()
            .withVersion(Environment.ST_KAFKA_VERSION)
            .withReplicas(kafkaReplicas)
            .addToConfig("log.message.format.version", TestKafkaVersion.getKafkaVersionsInMap().get(Environment.ST_KAFKA_VERSION).protocolVersion())
            .addToConfig("offsets.topic.replication.factor", Math.min(kafkaReplicas, 3))
            .addToConfig("transaction.state.log.min.isr", Math.min(kafkaReplicas, 2))
            .addToConfig("transaction.state.log.replication.factor", Math.min(kafkaReplicas, 3))
            .withNewListeners()
                .withNewPlain().endPlain()
                .withNewTls().endTls()
            .endListeners()
            .withNewInlineLogging()
                .addToLoggers("log4j.rootLogger", "DEBUG")
            .endInlineLogging()
        .endKafka()
        ...
        ... (more configs...)
        ... 
    .endSpec()
    .done()
```

In this case you can imagine that it is really easy to create multiple different instances of the Kafka instead of having separate objects.

## Resources

Resources in our way are abstraction to the `.yaml` definitions of custom resources which we provide such as Kafka, KafkaTopic, KafkaUser, KafkaConnect, KafkaMirrorMaker and so on.
These custom resources are encapsulated into java objects and some of you can remind the [ORM(Object Relation Mapping)](https://www.tutorialspoint.com/hibernate/orm_overview.htm) from databases. In the following Figure 1.1 we can see YAML representation of KafkaTopic and on the Figure 1.2 related JAVA object.

Figure 2.1 YAML representation of KafkaTopic
```
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
Figure 2.2 Loading the YAML file to JAVA representation object.
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
        .addToConfig("min.insync.replicas", minIsr)
    .endSpec();
```

Everything is build with three stacks. These three stacks are managed by `ResourceManager`, which is taking care of switching. First one is `method stack` where his responsibility is to hold all
resources, which are invoked in the test cases. Second one is the `class stack` where his responsibility is to hold all resources,
which are invoked in the @BeforeAll notation. Switching between these two stacks are doing the third stack called pointer stack. The pointer stack points to class stack where it is in the @BeforeAll notation otherwise we are working with the method stack. The logic inside these stacks are that if you create some resource
for instance KafkaTopic. It will be pushed inside the stack and the deletion of topic will be planned. In the teardown phase method stack will pop all resources after test case is over and same logic applied with class stack, which will pop all resources when test suite is over. What is worth mentioning is that if you specify `SKIP_TEARDOWN` environment variable to `TRUE` it will skip the teardown phase and all created resources will be there.

## Lifecycle of tests

Like any other test life cycle, ours are no different and follow the SEVT convention. SEVT stands for Setup, Exercise, Verify and Teardown.
The fundamental idea can be illustrated as follows:

```
1.SETUP        | instance = new Instance(); 
2.EXERCISE     | instance.setSomeValue(someValue);
3.VERIFY       | asserThat(instance.getSomeValue(), is(someValue));
4.TEARNDOWN    | instance = null; (this steps is prevailingly done by testing Frameworks)
```

#### Setup

In this phase we perform:

* Create namespace(s)
* Deploy the Strimzi Cluster operator
* Deploy the Kafka cluster and/or other components (optional)

The reason why the last point is optional, is because we have some test cases where you want to have a different kafka configuration for each test scenario, so creation of the Kafka cluster and other resources is done in the test phase.

We create resources in Kubernetes cluster via classes in `resources` package, which allows you to deploy all components and, if needed, change them from their default configuration using a builder.
Currently, we have two stacks, which are stored in `ResourceManager` singleton instance — one for all test class resources and one for test method resources.
You can create resources anywhere you want. Our resource lifecycle implementation will handle insertion of the resource on top of stack and deletion at the end of the test method/class.


`ResourceManager` stores info, which stack is currently active (class or method) in pointer stack.
You can change between class and method resources stack with method `ResourceManager.setMethodResources()` or `ResourceManager.setClassResources()`.
Note that pointer stack is set automatically in `AbstractST.class` in `@BeforeAll` or `@BeforeEach` methods.

Cluster Operator setup example:
```
    @BeforeAll
    void createClassResources() {
        prepareEnvForOperator(NAMESPACE);                          <--- Create namespaces
        createTestClassResources();                                <--- Create Resources instance for class
        applyRoleBindings(NAMESPACE);                              <--- Apply Cluster Operator bindings
        KubernetesResource.clusterOperator(NAMESPACE).done();      <--- Deploy Cluster Operator
        ...
    }
```

#### Exercise
In this phase you specify all steps which you need to execute to cover some specific functionality. Reasonable example would be
the Figure 1.4 from previous section, where we setup Kafka cluster with new persistent claim storage.

#### Verify

When your environment is in place from the previous phase, you can add code for some checks, msg exchange, etc.

#### Teardown

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

so if you want to change teardown from your `@AfterAll`, you must override method `tearDownEnvironmentAfterAll()`:
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

## Auxiliary classes

In our system test module we have many classes, which providing help. Each of them has different purpose and here is the list:

1. Utils
2. Constants
3. Environment
4. Kubernetes client
5. Kafka clients
6. Deployment file

#### Utils

These classes are applicable on many problems. We have separate utils for each resource. For instance we have KafkaUtils for KafkaResource, KafkaTopic for KafkaResource and so on. Furthermore, we have got
Kubernetes related utils such as ServiceUtils, PodUtils, DeploymentsUtils and many more. The hierarchy is as follows:

* utils
  * kafkaUtils
    * KafkaBridgeUtils
    * KafkaConnectorUtils
    * KafkaConnectS2IUtils
    * KafkaConnectUtils
    * KafkaMirrorMaker2Utils
    * KafkaMirrorMakerUtils
    * KafkaRebalanceUtils
    * KafkaTopicUtils
    * KafkaUserUtils
    * KafkaUtils
  * kubeUtils
    * controllers
      * ConfigMapUtils
      * DeploymentConfigUtils
      * DeploymentUtils
      * ReplicaSetUtils
      * StatefulSetUtils
    * objects
      * NamespaceUtils
      * PersistentVolumeClaimUtils
      * PodUtils
      * SecretUtils
      * ServiceUtils
  * specific
    * BridgeUtils
    * CruiseControlUtils
    * KeycloakUtils
    * MetricUtils
    * TracingUtils
    
The usability of these classes is for instance when you have to to wait for some change, calling API, creating, changing, deleting Kubernetes resource and much more.
The one method which deserves to be described is `waitFor`, where you will find it in many utils methods.
You can imagine the scenario, where you will change some custom resource value of Kafka and then you will want to assert
that this value was updated but here is very good example where comes `race condition` into play. This race condition
can occur if the assertion (verify phase) is too quick and value has not been updated. That's why we have these dynamic
wait. The logic behind this method is that every `pollIntervalMs` for specific period of time `timeoutMs` the method checks
`BooleanSupplier` condition which user can provide and if this condition is true the method will successfully end. Otherwise, we will get the
`WaitException` with some reasonable description. In the Figure 4.1 we can see the whole `waitFor` method.

##### Figure 4.1
```
public static long waitFor(String description, long pollIntervalMs, long timeoutMs, BooleanSupplier ready, Runnable onTimeout) {
        LOGGER.debug("Waiting for {}", description);
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (true) {
            boolean result;
            try {
                result = ready.getAsBoolean();
            } catch (Exception e) {
                result = false;
            }
            long timeLeft = deadline - System.currentTimeMillis();
            if (result) {
                return timeLeft;
            }
            if (timeLeft <= 0) {
                onTimeout.run();
                WaitException waitException = new WaitException("Timeout after " + timeoutMs + " ms waiting for " + description);
                waitException.printStackTrace();
                throw waitException;
            }
            long sleepTime = Math.min(pollIntervalMs, timeLeft);
            if (LOGGER.isTraceEnabled()) {
                LOGGER.trace("{} not ready, will try again in {} ms ({}ms till timeout)", description, sleepTime, timeLeft);
            }
            try {
                Thread.sleep(sleepTime);
            } catch (InterruptedException e) {
                return deadline - System.currentTimeMillis();
            }
        }
    }
```

#### Constants

Purpose of this class is to keep global constants used across system tests. You can find the constants for timeout
interval, poll internal used inside `waitFor` method. Moreover, you can find timeout for cluster operator and clients.
Also, we have here specific ports such as KafkaBridge metric, TopicOperator metric, Keycloak and so on. Lastly, here we have all tags names,
which we used in whole system test module for instance `ACCEPTANCE`, `REGRESSION` and more.
 
#### Environment

System tests can be configured by several environment variables, which are loaded before test execution.

Variables can be defined via environmental variables or a configuration file, this file can be located anywhere on the file system as long as a path is provided to this file.
The path is defined by environmental variable `ST_CONFIG_PATH`, if the `ST_CONFIG_PATH` environmental variable is not defined, the default config file location is used `systemtest/config.json`.
Loading of system configuration has the following priority order:
1. Environment variable
2. Variable defined in configuration file
3. Default value

Here is the list of important environment variables:

1. DOCKER_ORG = Specify the organization/repo containing the image used in system tests |`strimzi`|
2. DOCKER_TAG = Specify the image tags used in system tests |`latest`|
3. SKIP_TEARDOWN = Variable for skip teardown phase for more debug if needed |`false`|
4. ST_KAFKA_VERSION =  Kafka version used in images during the system tests |`2.6.0`|

#### Our Kafka clients

Another helpful part of the system tests are Kafka clients. In this module we have three types:

1. Internal using test-client image
2. Internal using client-examples image
3. External using Vertx.io client

##### Internal using test-client image

The first client using the our image. Basically, it is defined as a deployment and inside the container, we start the `kafka-verifiable-(consumer|producer).sh` shell script. In case of more interest you can [here](https://github.com/strimzi/strimzi-kafka-operator/tree/master/docker-images/test-client).
The usage of this client is simple because it is implemented by Builder pattern, which I previously mentioned. For instance, if we want
to create some producer or consumer we can easily do:

```
1. Creating the client instance 

InternalKafkaClient internalKafkaClient = new InternalKafkaClient.Builder()
    .withUsingPodName("kafka-client-pod")
    .withTopicName("topic-name")
    .withNamespaceName("namespace-name")
    .withClusterName("cluster-name")
    .withMessageCount(100)
    .build();

2. Sending messages by interface method

internalKafkaClient.sendMessagesPlain();  <- for plain communication
```

Note, also that before sending messages to the Kafka cluster we need ensure that test-client pod is running and it can done via this code, which basically creates the pod,
where inside this one is running test-client and waiting for commands invoked by `kafka-verifiable-(consumer|producer).sh`.

```
KafkaClientsResource.deployKafkaClients(false, CLUSTER_NAME + "-" + Constants.KAFKA_CLIENTS).done();
```

##### Internal using client-examples image

The second one is based on client-examples images, where everything about client implementation with also Dockerfiles can be found [here](https://github.com/strimzi/client-examples).
These type of client we are using as Job. For instance if we want to send some messages we write it like this:

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

##### External using Vertx.io client

Lastly, we have our external clients implemented by support of Vertx.io Verticles. This type of client has the most limitation such as
dependent on external listeners, which caused `platform dependency`. Implemented by Abstract recursive builder, which makes these
clients very handful. Moreover, we have `Oauth`, `Tracing` and also `Basic` client. Each of them are for specific use case. However,
we prefer to always use the internal clients because of that platform dependency. Client can be used for instance:

```
1. Creating the client instance 

BasicExternalKafkaClient basicExternalKafkaClient = new BasicExternalKafkaClient.Builder()
    .withTopicName("topic-name")
    .withNamespaceName("namespace-name")
    .withClusterName("cluster-name")
    .withKafkaUsername("kafka-username")
    .withMessageCount(100)
    .withSecurityProtocol(SecurityProtocol.SSL)
    .build();

2. Sending messages

basicExternalKafkaClient.sendMesssageTls();
```

## Dependencies

Before we get to writing simple test case in Strimzi system tests, we need to know main dependencies that system test module have. I gonna describe the most important one like:
1. test (kubernetes client)
2. crd-generator + api (chaining / builder pattern)

### test module

In the test module, we have the Kubernetes client, which we use in the system tests to create, list, delete, update
Kubernetes resources such as Service, Deployment, Pod, ConfigMap and so on. Basically, we encapsulate the [Kubernetes client](https://github.com/fabric8io/kubernetes-client)
from fabric8 to use client more handy with not additional and typically redundant method chaining. Moreover, we have our
abstraction of Kubernetes cluster and mechanism to detect on which type is currently client. Clusters could be Kubernetes, Minikube and so on.

### crd-generator + api module (not sure about this one...)

In the crd-generator and api modules, we basically use all resources, which we previously described in Resource section. Every time,
if the code of Model changes you have to build the whole modules to generate new schema for resources. For instance imagine that you are using
Kafka resource and you need to create Kafka with the Cruise Control support but you have got old schemas, which does not support it.
You will need to build these modules and generate schema, which will support it and be able to create Kafka with Cruise Control. This modules provides us the fluent
way of creating Strimzi custom resources instances such as Kafka, KafkaConnect, KafkaConnectS2I, KafkaMirrorMaker and much more.

## How to create a system test

Now, we have all knowledge to create a simple test. There is also some precursors, which i will write it down.

### Precursors

1. Fork the `strimzi-kafka-operator` repository - https://github.com/strimzi/strimzi-kafka-operator
2. Build the whole project in root directory - `mvn clean install -DskipTests`
3. Setup your Kubernetes cluster
4. Login to your Kubernetes cluster
5. Try to start some of our tests inside system test module for instance - `io.strimzi.systemtest.bridge.HttpBridgeST.testSendSimpleMessage()` (take takes around 5 minutes)

### Writing new test case

We will try to create a very simple test using our Resources, Utils, Kubernetes client and so on.

Description of the test case: We need to verify that Kafka can be deployed without any problem and then that
clients can send messages to Kafka cluster and receive messages from them. So as you can see, we have two main
things to take care. First is `verify that Kafka can be deployed` and the second one is `clients can send messages to Kafka cluster and receive messages from them`.

Test scenario could look like this:

1. Deploy Strimzi Operator <- setup + exercise
2. Deploy Kafka cluster with 3 kafka nodes and 3 zookeeper nodes <- setup + exercise
3. Verify that Kafka is ready <- verify
4. Create instance of Kafka clients <- setup + exercise
5. Send messages to Kafka cluster <- exercise
6. Receive messages from Kafka cluster <- exercise
7. Verify that we have sent and received excepted count of messages <-verify

Note, that teardown phase is down automatically done by our mechanism so there is no need to take care of it.

Test case then can look like this:

```
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

Congratulations to writing your new test cases on Strimzi system test module!

## Conclusion

The whole ecosystem of system tests is at first glance hard to understand but if the person who is learning this domain
got a drive, It won't be a challenge for him. Whole module passed through several changes, which improve many areas. We are open to
any discussion, which can create or change the behavior to robust, better way of tests. Maybe you will be the one who
will change the structure of system tests and make this even better!