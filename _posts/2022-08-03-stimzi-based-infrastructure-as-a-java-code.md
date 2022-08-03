---
layout: post
title: "Strimzi-based Apache Kafka infrastructure as Java code"
date: 2022-08-03
author: jakub_scholz
---

When you say _Infrastructure as Code (IaC)_, people usually imagine tools such as Terraform, Ansible or Amazon AWS CloudFormation.
All these tools use some kind of configuration or markup language to write the code.
Terraform uses the HCL language, Ansible uses YAML and AWS CloudFormation can use either YAML or JSON.
Strimzi supports this pattern as well.
You describe your Strimzi-based Apache Kafka infrastructure in the YAML format when you create the Kubernetes custom resources.
And Kubernetes together with the Strimzi operators take care of transforming this _code_ into the actual Apache Kafka brokers, users, topics or for example connectors.
But what if you want to use a full-fledged programming language for your infrastructure ... for example Java?
This blog post will tell you why you might be interested in this and show you how to do it.

<!--more-->

Of course, there is a reason why most IaC tools use markup or configuration languages.
They have many advantages:
* They are easy to read, review and edit.
* They do not need any compilation, compilers or complicated IDEs.
* Since they are basically just text files, they are platform independent.

But sometimes, it makes more sense to manage the infrastructure directly from a proper programming language such as Java.
For example, when you write a self-service portal for your developers to manage and provision their Apache Kafka infrastructure.
It might be easier to do it directly from the developer portal application code instead of generating some YAML text files.
Another example might be when you want to manage your Kafka infrastructure directly from some integration or system tests written in Java.
You can create a Kafka cluster or prepare Kafka topics directly in the setup phase before each of your tests.

### Strimzi `api` module

Strimzi is written in Java.
The main interface used by Strimzi users are the Kubernetes Custom Resource Definitions (CRDs) and Custom Resources (CRs).
They constitute the main Strimzi API.
But we of course do not write the CRDs by hand.
Instead, we have Java classes representing the custom resources and their definition.
These Java classes live in the `api` module.

They are used in multiple different ways.
The YAML files with the CRD definitions are automatically generated based on them.
The [API reference part of our documentation](https://strimzi.io/docs/operators/latest/full/configuring.html#api_reference-str) is automatically generated from these files.
And they are (together with some automatically generated builder and fluent classes) also used by the Strimzi operators to work with the custom resources. 

When the operator queries the Kubernetes API or receives some event from it, it will be serialize in JSON format.
The operators will decode the custom resources from JSON into regular Java objects.
And when the operator needs to modify any of the custom resources, it will again use the Java objects to do so.
And they will be converted from the Java format into JSON again before updating them in the Kubernetes API.
This all happens automatically with the help of few libraries:
* The [Sundrio code generation toolkit](https://github.com/sundrio/sundrio) is used to generate the builder and fluent interfaces for the Strimzi custom resources
* The [Fabric8 Kubernetes client](https://github.com/fabric8io/kubernetes-client) is used to communicate with the Kubernetes API and together with the [FasterXML Jackson library](https://github.com/FasterXML/jackson) does the decoding and encoding between JSON or YAML and Java.

And the best thing about this is that its use is not limited only to the Strimzi operators.
If you want, you can use it as well!

### Using the `api` module

With every Strimzi release, we publish the `api` library to the [Maven Central repository](https://mvnrepository.com/artifact/io.strimzi/api).
So you can easily include it in your Java project.
For example, if you use Maven to build your project, you can just add the following dependency:

```xml
<dependency>
    <groupId>io.strimzi</groupId>
    <artifactId>api</artifactId>
    <version>0.30.0</version>
</dependency>
```

The dependencies of the `api` library are the Fabric8 Kubernetes client and the Jackson libraries which will be needed as well.
Once you have the library included in your project, you can use it together with the Fabric8 Kubernetes client.

Keep in mind that the `api` is only used to work with the custom resources.
It does not include the Strimzi operators.
So you also need to have Strimzi deployed in your Kubernetes cluster.
Without it, you might be able to create the custom resources, but nothing will happen with them.

### Deploying a new Kafka cluster

Let's start with a simple example where we create a new Kafka cluster.
First, we need to create the `Kafka` object.
We can use the builder interface to do it:

```java
Kafka kafka = new KafkaBuilder()
        .withNewMetadata()
        .withName(NAME)
            .withNamespace(NAMESPACE)
        .endMetadata()
        .withNewSpec()
            .withNewZookeeper()
                .withReplicas(3)
                .withNewEphemeralStorage()
                .endEphemeralStorage()
            .endZookeeper()
            .withNewKafka()
                .withReplicas(3)
                .withListeners(new GenericKafkaListenerBuilder()
                        .withName("plain")
                        .withType(KafkaListenerType.INTERNAL)
                        .withPort(9092)
                        .withTls(false)
                        .build())
                .withNewEphemeralStorage()
                .endEphemeralStorage()
            .endKafka()
            .withNewEntityOperator()
                .withNewTopicOperator()
                .endTopicOperator()
                .withNewUserOperator()
                .endUserOperator()
            .endEntityOperator()
        .endSpec()
        .build();
```

This creates a `Kafka` object which will correspond to the following YAML:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: <NAME>
  namespace: <NAMESPACE>
spec:
  kafka:
    replicas: 3
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
    storage:
      type: ephemeral
  zookeeper:
    replicas: 3
    storage:
      type: ephemeral
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

It will be a Kafka cluster with 3 ZooKeeper and 3 Kafka nodes.
It will use ephemeral storage and have one listener on port 9092.
And it will also enable the Topic and User operators.

When you create the Java object, it exists only in our Java application.
So as the next step, we need to create it inside our Kubernetes cluster using the Kubernetes API.
To achieve that, we need to:
* Create an instance of the Fabric8 Kubernetes client
* Use the client instance to create the Kafka resource

This can be done with the following two lines of code:

```java
KubernetesClient client = new DefaultKubernetesClient();
Crds.kafkaOperation(client).inNamespace(NAMESPACE).create(kafka);
```

And that is it, the custom resource is created in our Kubernetes cluster.
When watching the Kubernetes cluster - for example using `kubectl get pods -w` - we should see the ZooKeeper and Kafka pods starting.
We can of course wait for the Kafka cluster to be deployed and ready to use from the Java code as well.
We just need to watch the `.status` section of the custom resource and wait until it says the cluster is ready:

```java
Crds.kafkaOperation(client).inNamespace(NAMESPACE).withName(NAME).waitUntilCondition(k -> {
    if (k.getStatus() != null && k.getStatus().getConditions() != null) {
        return k.getMetadata().getGeneration() == k.getStatus().getObservedGeneration()
                && k.getStatus().getConditions().stream().anyMatch(c -> "Ready".equals(c.getType()) && "True".equals(c.getStatus()));
    } else {
        return false;
    }
}, 5, TimeUnit.MINUTES);
```

The example above will wait for 5 minutes for the cluster to be ready.

### Updating an existing Kafka cluster

The `api` library can be used to modify existing resources as well.
We need to get the existing custom resource from the Kubernetes API using the client and then we edit it:

```java
KubernetesClient client = new DefaultKubernetesClient();
final Kafka updatedKafka = Crds.kafkaOperation(client).inNamespace(NAMESPACE).withName(NAME)
        .edit(k -> new KafkaBuilder(k)
                .editSpec()
                    .editKafka()
                        .withConfig(Map.of("auto.create.topics.enable", "false"))
                    .endKafka()
                .endSpec()
                .build());
```

For example in the code snippet above, we change the configuration of the Kafka brokers to disable auto-creation of Kafka topics.
The code uses the builder interface again to make it easier to edit just one part of the custom resource.
This code already updates the custom resource inside the Kubernetes API.
The new YAML corresponding to the Java code would look like this:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: <NAME>
  namespace: <NAMESPACE>
spec:
  kafka:
    replicas: 3
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
    storage:
      type: ephemeral
    config:
      auto.create.topics.enable: "false"
  zookeeper:
    replicas: 3
    storage:
      type: ephemeral
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

Once the resource is updated in Kubernetes, Strimzi will need to roll the Kafka cluster to apply the change.
We can once again wait for it to complete:

```java
Crds.kafkaOperation(client).inNamespace(NAMESPACE).withName(NAME).waitUntilCondition(k -> {
    if (k.getStatus() != null && k.getStatus().getConditions() != null) {
        return updatedKafka.getMetadata().getGeneration() == k.getStatus().getObservedGeneration()
                && k.getStatus().getConditions().stream().anyMatch(c -> "Ready".equals(c.getType()) && "True".equals(c.getStatus()));
    } else {
        return false;
    }
}, 5, TimeUnit.MINUTES);
```

While waiting for the change to be applied, it is important to not just check the status conditions.
We need to also check that the `observedGeneration` in the `.status` section is the same as the `generation` in the `.metadata` section.
That will guarantee that the `Ready` condition is valid for the modification we just did and not for the previous version of the Kafka cluster.

### Deleting the Kafka cluster

When we are done with the Kafka cluster - for example because all our tests are finished - we might want to delete it.
Deleting the Kafka cluster with the Strimzi `api` library is easy.
You just need to create the Kubernetes client and call the `delete` method like in the following example:

```java
KubernetesClient client = new DefaultKubernetesClient();
Crds.kafkaOperation(client).inNamespace(NAMESPACE).withName(NAME).delete();
```

This will delete the custom resource from the Kubernetes API and the Strimzi operator together with the Kubernetes garbage collection will take care of the rest.

### Other custom resources

In the previous sections, we looked at how to create, update and delete a Strimzi-based Apache Kafka cluster from a Java application.
The same can be of course used for all other Strimzi custom resources.
So you are not limited only to Kafka clusters.

### Complete examples

The full source codes used in this blog post can be found in my [GitHub repository](https://github.com/scholzj/strimzi-api-examples).
It does not contain examples for all custom resources, but if you want to add some more, feel free to open PR or an issue.
The repository also contains an example of how you can install the Strimzi Cluster Operator directly from a Java application.
Feel free to reuse and share these examples as needed.

### What about other languages?

In this blog post, we focused only on Java.
What if you are using some other programming language?

For example, for Golang, there are several projects which allow you to generate Go structures from the YAML files to help you with managing your Kubernetes resources.
One of them is for example the [Reverse Kube Resource](https://github.com/wozniakjan/reverse-kube-resource).
Many clients also allow you to use dynamic or raw resources - they use untyped resources constructed out of generic structures such as maps.
One example of using the dynamic resources is in the [GitHub repository](https://github.com/kubernetes/client-go/tree/master/examples/dynamic-create-update-delete-deployment) of the Go Kubernetes client.

Or - if you want - you can also contribute a generator of the structures for other programming languages to Strimzi.
The Strimzi CRD generator, which we already use to generate the CRD YAMLs or the documentation can be extended to generate also some Golang data structures.
Contributions are always welcomed 😍.
