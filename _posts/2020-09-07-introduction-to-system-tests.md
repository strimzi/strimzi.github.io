---
layout: post
title:  "Introduction to system tests"
date: 2020-09-07
author: maros_orsak
---

Lessons learn from past years shown that testing is the essential part of the software cycle.
We have known many failures that happened because of neglect testing.
In Strimzi, we exactly know how we should test the features.
Follow me on this blog post and see the basic view of our tests.

In this blog post we are gonna look at system tests and I will give you motivation why you should look at it.
The content is as follows:

# Content
1. [Motivation](#Resources)
2. [How they differ from our UT and IT](#Lifecycle of tests)
3. [How they run in relation with Kubernetes](#Auxiliary classes)
4. [How to run them](#How to create a system test)
5. [Conclusion](#Conclusion)

## Motivation

Maybe you ask yourself these questions.
Why do we need to write system tests?
What is the value of it?
Do they catch errors that unit or integration tests doesn't?
The answer is very simple.
Yes!
System Tests are the core unit to be able ship the product to the customer with more confidence that it will not crash in the production.
These types of tests, which  validate the basic properties of system we call [Smoke tests](https://www.guru99.com/smoke-testing.html).
They ensure to detect major issues such as deployment of application with general configuration and so on.
Moreover, we have got the regression test suites, which coverage most of all features and will definitely find a bug.
In the next section i will describe the difference between our system tests, integration and unit tests.

## How they differ from our unit and integration tests

Firstly, we should know what is the purpose of the Unit test. Let's define information definition of unit test.

> A unit test exercises a single behavior of a software module.
> That module is usually a class, and the behavior is usually a public method of the class.
> The test asserts that the actual result matches the expected result.
> These assertions must all pass, or the unit test will fail. (Ryan Cook)

Our unit tests don't do anything special.
For clarification I can show you an example of our unit test for instance in `cluster-operator` module.
This is the test case, which verify that if we setup `Kafka` with external listener Nodeport then `Kafka` in-memory representation
of class will contains the external port name, external port 9094 with protocol TCP and more.
You should see that everything what this type of test validates is only single behaviour of a sofware module that we define
previously.
We have no running `Kubernetes cluster`.
It is only in-memory representation of class in that case `Kafka` model.

```java
@Test
public void testExternalNodePorts() {
    Kafka kafkaAssembly = new KafkaBuilder(ResourceUtils.createKafka(namespace, cluster, replicas,
            image, healthDelay, healthTimeout, metricsCm, configuration, emptyMap()))
            .editSpec()
                .editKafka()
                    .withNewListeners()
                        .withNewKafkaListenerExternalNodePort()
                            .withNewKafkaListenerAuthenticationTlsAuth()
                            .endKafkaListenerAuthenticationTlsAuth()
                        .endKafkaListenerExternalNodePort()
                    .endListeners()
                .endKafka()
            .endSpec()
            .build();
    KafkaCluster kc = KafkaCluster.fromCrd(kafkaAssembly, VERSIONS);

    // Check StatefulSet changes
    StatefulSet sts = kc.generateStatefulSet(true, null, null);

    List<ContainerPort> ports = sts.getSpec().getTemplate().getSpec().getContainers().get(0).getPorts();
    assertThat(ports.contains(kc.createContainerPort(KafkaCluster.EXTERNAL_PORT_NAME, KafkaCluster.EXTERNAL_PORT, "TCP")), is(true));

    // Check external bootstrap service
    Service ext = kc.generateExternalBootstrapService();
    assertThat(ext.getMetadata().getName(), is(KafkaCluster.externalBootstrapServiceName(cluster)));
    assertThat(ext.getSpec().getType(), is("NodePort"));
    assertThat(ext.getSpec().getSelector(), is(kc.getSelectorLabels().toMap()));
    assertThat(ext.getSpec().getPorts(), is(Collections.singletonList(kc.createServicePort(KafkaCluster.EXTERNAL_PORT_NAME, KafkaCluster.EXTERNAL_PORT, KafkaCluster.EXTERNAL_PORT, "TCP"))));
    checkOwnerReference(kc.createOwnerReference(), ext);

    // Check per pod services
    for (int i = 0; i < replicas; i++)  {
        Service srv = kc.generateExternalService(i);
        assertThat(srv.getMetadata().getName(), is(KafkaCluster.externalServiceName(cluster, i)));
        assertThat(srv.getSpec().getType(), is("NodePort"));
        assertThat(srv.getSpec().getSelector().get(Labels.KUBERNETES_STATEFULSET_POD_LABEL), is(KafkaCluster.kafkaPodName(cluster, i)));
        assertThat(srv.getSpec().getPorts(), is(Collections.singletonList(kc.createServicePort(KafkaCluster.EXTERNAL_PORT_NAME, KafkaCluster.EXTERNAL_PORT, KafkaCluster.EXTERNAL_PORT, "TCP"))));
        checkOwnerReference(kc.createOwnerReference(), srv);
    }
}
```

The next one is the integration tests, which step one level higher.
You can find all these tests inside our `api` module.
Before we get into detail again we should understand the informal definition of integration tests.

> Integration tests determine if independently developed units of software work correctly when they are connected to each other. (Martin Fowler)

In our case the purpose of integration tests is to ensure that we can create a resource from the POJOs, serialize it and
create the resource in K8S.
You should notice that in that level of testing we are using the Kubernetes cluster to do validation of custom resources.
To make this all easy to understand let me clarify it with example:

```java
@Test
public void testKafkaWithEntityOperator() {
    createDelete(Kafka.class, "Kafka-with-entity-operator.yaml");
}

protected <T extends CustomResource> void createDelete(Class<T> resourceClass, String resource) {
    T model = loadResource(resourceClass, resource);  <--- load model in that case Kafka model representation
    String modelStr = TestUtils.toYamlString(model);  
    assertDoesNotThrow(() -> createDelete(modelStr), 
"Create delete failed after first round-trip -- maybe a problem with a defaulted value?\nApplied string: " + modelStr);
    }
```

You can see that the test case basically apply the YAML representation of Kafka and except that will not fail and everything
is correct.
This is applied for every custom resource supported by `Strimzi` for instance `KafkaConnect`, `KafkaMirrorMaker`, `KafkaBridge`,
                                                                         `KafkaTopic`, `KafkaUser` and so on.

After this level is successfully completed we can talk about our system tests.
Let's firstly see the informal definition:

> System testing is a level of testing that validates the complete and fully integrated software product.
> The purpose of a system test is to evaluate the end-to-end system specifications.
> Usually, the software is only one element of a larger computer-based system.
> Ultimately, the software is interfaced with other software/hardware systems.
> System Testing is actually a series of different tests whose sole purpose is to exercise the full computer-based system. (Guru)

In our case the system tests validates the whole components/features which Strimzi provides.
Everything is tested in Kubernetes environment to fully represent production or user environment.
Again to clarify I have an example:

    ```java
@Test
void testReceiveSimpleMessage() {
    KafkaTopicResource.topic(CLUSTER_NAME, TOPIC_NAME).done();

    kafkaBridgeClientJob.consumerStrimziBridge().done();

    // Send messages to Kafka
    InternalKafkaClient internalKafkaClient = new InternalKafkaClient.Builder()
        .withTopicName(TOPIC_NAME)
        .withNamespaceName(NAMESPACE)
        .withClusterName(CLUSTER_NAME)
        .withMessageCount(MESSAGE_COUNT)
        .withKafkaUsername(USER_NAME)
        .withUsingPodName(kafkaClientsPodName)
        .build();

    assertThat(internalKafkaClient.sendMessagesPlain(), is(MESSAGE_COUNT));

    ClientUtils.waitForClientSuccess(consumerName, NAMESPACE, MESSAGE_COUNT);
}

@BeforeAll
void createClassResources() throws Exception {
    deployClusterOperator(NAMESPACE);
    LOGGER.info("Deploy Kafka and KafkaBridge before tests");
    // Deploy kafka
    KafkaResource.kafkaEphemeral(CLUSTER_NAME, 1, 1).done();

    KafkaClientsResource.deployKafkaClients(false, KAFKA_CLIENTS_NAME).done();

    kafkaClientsPodName = kubeClient().listPodsByPrefixInName(KAFKA_CLIENTS_NAME).get(0).getMetadata().getName();

    // Deploy http bridge
    KafkaBridgeResource.kafkaBridge(CLUSTER_NAME, KafkaResources.plainBootstrapAddress(CLUSTER_NAME), 1)
        .editSpec()
            .withNewConsumer()
                .addToConfig(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest")
            .endConsumer()
        .endSpec()
        .done();
}
```

This test case as you can see ensures that we are able to receive messages from `KafkaBridge` component.
In the setup phase we deploy `cluster-operator`, one node Kafka cluster and also the `KafkaBridge` itself.
Everything is inside the real Kubernetes cluster.
All test cases with related test suites can be found in the `system-test` module to make it more sense.
What is also worth to mentioned that our system test currently takes around ~30 hours but we have 3 separate sub-sets, which
runs in parallel so it is "only" approximately 10h per each sub-set.
Additionally, there is also a mvn profile for the main groups - `acceptance`, `regression`, `smoke`, `bridge` and `all`,
but we suggest to use profile with id `all` (default) and then include or exclude specific groups.
If you want specify the profile, use the `-P` flag for example `-Psmoke`.
                                                               All available test groups are listed in [Constants](https://github.com/strimzi/strimzi-kafka-operator/blob/master/systemtest/src/main/java/io/strimzi/systemtest/Constants.java)
class.

## How they run with relation with Kubernetes

Basically, what I mentioned in previous section system tests run against real Kubernetes cluster.
You can run these tests against `Minikube`, `Minishift`, big `Kubernetes` or `Openshift` cluster.
In the `test` module we have our representation of cluster which decide on which environment it is running.
Moreover, we are using `Azure pipelines` to trigger these tests and using `Minikube`.

## How to run them

Running the system tests is easy thing and nobody should be scared of.

### Generally

The steps are as follows:

1. Fork the [strimzi-kafka-operator](https://github.com/strimzi/strimzi-kafka-operator)
2. Build the whole project in root directory - `mvn clean install -DskipTests`
3. Setup your Kubernetes cluster
4. Login to your Kubernetes cluster
5. Try to start some of our tests inside system test module for instance - `io.strimzi.systemtest.bridge.HttpBridgeST.testSendSimpleMessage()` (take takes around 5 minutes)

### Using custom images

If you are interest running custom images you should take a look on file which is located inside install directory and
you can be see it [here](https://github.com/strimzi/strimzi-kafka-operator/blob/master/install/cluster-operator/060-Deployment-strimzi-cluster-operator.yaml).
There are few attributes that you need to change for instance:

- `Cluster Operator` image = specify [here](https://github.com/strimzi/strimzi-kafka-operator/blob/master/install/cluster-operator/060-Deployment-strimzi-cluster-operator.yaml#L26)
- `Kafka` image = STRIMZI_KAFKA_IMAGES
- `KafkaConnect` image  = STRIMZI_KAFKA_CONNECT_IMAGES
- `KafkaConnectS2I` image =  STRIMZI_KAFKA_CONNECT_S2I_IMAGES
- `KafkaMirrorMaker` image =  STRIMZI_KAFKA_MIRROR_MAKER_IMAGES
- `KafkaMirrorMake2` image =  STRIMZI_KAFKA_MIRROR_MAKER_2_IMAGES
- `Topic Operator` image =  STRIMZI_DEFAULT_TOPIC_OPERATOR_IMAGE
- `User Operator` image =  STRIMZI_DEFAULT_USER_OPERATOR_IMAGE
- `KafkaBridge` image =  STRIMZI_DEFAULT_KAFKA_BRIDGE_IMAGE
- `CruiseControl` image =  STRIMZI_DEFAULT_CRUISE_CONTROL_IMAGE

and so on.

### Using IDE

Also you can build and run some test from your favourite IDE.
    For instance in my case I am using InteliJ and the steps are as follows.

1. Fork the [strimzi-kafka-operator](https://github.com/strimzi/strimzi-kafka-operator)
2. Open the strimzi-kafka-operator project
3. You should probably see on the right side maven modules. Select `system-test` module.
4. Click on Lifecycle and then you will see `clean` and `install`.
5. Run any test you want.

## Conclusion

Today we have dive into system tests domain.
Simply, we learned about the motivation behind writing system tests.
Furthermore, we talked about the main differences unit, integration vs system tests.
Afterwards, we looked at the relation with the Kubernetes.
Lastly, we try the procedure how to start some system test.
Now you will be able to create your completely new system test in `Strimzi`!

Happy testing!!!