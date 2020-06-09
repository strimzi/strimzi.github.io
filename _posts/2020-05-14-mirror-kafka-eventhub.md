---
layout: post
title:  "Mirroring from Apache Kafka to Azure Event Hub"
date: 2020-05-14
author: paolo_patierno
---

Let's imagine having a software architecture based on Apache Kafka running in an on-premise Kubernetes installation and managed by the Strimzi operators.
All the services are able to communicate with each other exchanging messages through a set of topics.
At some point there is a new requirement to fullfil: all messages, sent to a specific topic, have to trigger some processing in the cloud via Microsoft Azure Functions already connected to an Azure Event Hub instance.
It is a third party application already in place that we need to integrate with our own system.
In order to avoid the producing applications having to connect to both the on-premise Apache Kafka cluster and to Azure Event Hub, which provides a Kafka protocol head, and sending each message twice, the best solution could be just mirroring the topic.
This blog post is going to show how to use the Strimzi cluster operator to configure and deploy Kafka Mirror Maker in order to mirror topics between two different systems like Apache Kafka and Azure Event Hub.

<!--more-->

### Integration overview

Before starting to deploy the different components, let's take a look at how they should be integrated and the related overall architecture.

![Overall architecture](/assets/images/posts/2020-05-14-kafka-mirror-eventhub.png)

On one side there is a Kubernetes cluster where an Apache Kafka cluster is deployed and managed via the Strimzi operators as well as the Kafka Mirror Maker instance.
An application, running on the same cluster, produces messages to an Apache Kafka topic and all the data are consumed by Kafka Mirror Maker in order to be mirrored to the remote Azure Event Hub instance.

On the other side there is the Azure Event Hub namespace, on the Microsoft Azure Cloud, where an Event Hub is filled by the messages mirrored from the corresponding Apache Kafka topic.
These messages trigger the Azure Functions platform to do the actual processing.

For simplicity, we are going to use a simple Kafka console producer for sending data on the on-premise Apache Kafka cluster and a simple Azure Function application which actually just logs every message received from the Event Hub.
Of course, the blog post will focus on configuring the mirroring part more than providing details about the Azure Event Hub creation or the Azure Functions application development.
Anyway, the source code will be available at this [repo](https://github.com/ppatierno/strimzi-eventhub).

### Strimzi operators: Apache Kafka and Mirror Maker

Deploying an Apache Kafka cluster on Kubernetes using Strimzi is pretty easy.
For this example, we are going to use `minukube` and just follow the corresponding [quickstart](https://strimzi.io/quickstarts/) for deploying the Strimzi operators and provisioning the Apache Kafka cluster.

After the operators and cluster are provisioned, in the `kafka` namespace, let's assume that the topic which has to be mirrored is named `testeh` and it's described through the following `KafkaTopic` resource, saved in a `kafka-topic.yaml` file.

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaTopic
metadata:
  name: testeh
  labels:
    strimzi.io/cluster: my-cluster
spec:
  partitions: 1
  replicas: 1
  config:
    retention.ms: 7200000
    segment.bytes: 1073741824
```

Create the topic on the Kubernetes cluster.

```shell
kubectl apply -f kafka-topic.yaml -n kafka
```

The Strimzi topic operator takes care of this custom resource, creating the topic in the Apache Kafka cluster.

### Azure Event Hub and the Apache Kafka protocol

Azure Event Hub is a fully managed, real-time data ingestion service provided by Microsoft as part of its Azure cloud offer.
The artchitectural concepts behind Event Hub are similar to Apache Kafka.
An Event Hub is like an Apache Kafka topic and it lives inside an Event Hub namespace that is a kind of Apache Kafka cluster; an Event Hub is partitioned as well.
Producer applications can publish messages using HTTPS and AMQP 1.0 protocols; consumer applications join consumer groups for receiving messages from the partitions, actually sharing the load across them.
A few months ago, Azure Event Hub was enriched with an Apache Kafka protocol head (1.0 and above).
It enables any Apache Kafka client to connect to an Event Hub, as if it was a "normal" Apache Kafka topic, for sending and receiving messages.
Leveraging this relatively new feature, it is possible to mirror data from an Apache Kafka cluster to Azure Event Hub, pretty easily using Kafka Mirror Maker.

> Whilst Kafka Mirror Maker 2 is gaining traction in the Kafka ecosystem, I faced some protocol compatibility issues with the Azure Event Hub protocol head. Therefore this post uses Kafka Mirror Maker whilst this is being investigated.

Assuming that the Apache Kafka topic to mirror is named `testeh`, we have to create a corresponding Event Hub in a related namespace.
It is possible to do that following the official Microsoft documentation, using the [Azure portal](https://docs.microsoft.com/en-us/azure/event-hubs/event-hubs-create), the [Azure CLI](https://docs.microsoft.com/en-us/azure/event-hubs/event-hubs-quickstart-cli), Azure Powershell or ARM template.

![Azure Portal: Event Hub creation](/assets/images/posts/2020-05-14-azure-portal-eventhub.png)

Having the Event Hub ready is just the first step.
In order to configure Kafka Mirror Maker for connecting to the Event Hub, we need to get the corresponding connection string in order to be authenticated and authorized to write on the Event Hub itself.
Just for simplicity, we can use the already provided `RootManageSharedAccessKey` policy that enables all the rights to manage, send and listen in the Event Hub namespace in which `testeh` lives.
In a real scenario, we would like to create a policy for the mirroring part in order to enable the Kafka Mirror Maker producer just to write to the Event Hub while using a different policy, with just the permission to listen, for the application consuming the messages. 

The only needed information from the above policy is the connection string which has the following format:

```
Endpoint=sb://<eventhubs-namespace>.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=<access-key>
```

Where `<eventhubs-namespace>` has to be replaced with the actual Event Hub namespace you are going to use.

![Azure Portal: Event Hub connection string](/assets/images/posts/2020-05-14-connectionstring-eventhub.png)

### Configure Kafka Mirror Maker

When mirroring messages from a source Apache Kafka cluster to a target one, the usual paradigm is deploying the Kafka Mirror Maker instance alongside the target cluster.
It means consuming remotely and producing locally.
In this integration scenario, it is not possible because there is no way to deploy Kafka Mirror Maker alongside the Event Hub namespace that is the target cluster.
For this reason, the paradigm will be slightly different, deploying Kafka Mirror Maker alongside the source Apache Kafka cluster where we have more control.
Anyway, it's worth mentioning that the Kubernetes cluster, where Apache Kafka runs, could be an AKS (Azure Kubernetes Service) one, part of the same Microsoft Cloud infrastructure at the Event Hub.

The first step is storing the Event Hub authentication info into a Kubernetes `Secret` in order to be referenced in the Strimzi `KafkaMirrorMaker` custom resource to enable the producer part to connect to the Event Hub itself.
The following snippet shows the endpoint that has to be customized with the actual Event Hub connection string; save this `Secret` in a file named `eventhubs-secret.yaml`

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: eventhubssecret
type: Opaque
stringData:
  eventhubspassword: Endpoint=sb://<eventhubs-namespace>.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=<access-key>
```

Create the `Secret` on the Kubernetes cluster.

```shell
kubectl apply -f eventhubs-secret.yaml -n kafka
```

The Kafka Mirror Maker instance is deployed via the Strimzi cluster operator through a corresponding `KafkaMirrorMaker` resource as the following.

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaMirrorMaker
metadata:
  name: my-mirror-maker
spec:
  version: 2.4.0
  replicas: 1
  consumer:
    bootstrapServers: my-cluster-kafka-bootstrap:9092
    groupId: my-source-group-id
  producer:
    bootstrapServers: <eventhubs-namespace>.servicebus.windows.net:9093
    authentication:
      type: plain
      username: $ConnectionString
      passwordSecret:
        secretName: eventhubssecret
        password: eventhubspassword
    tls:
      trustedCertificates: []
  whitelist: ".*"
```

The `consumer` part just connects to the local Apache Kafka cluster running on the same Kubernetes instance.

The `producer` part connects to the Event Hub namespace, through TLS and PLAIN authentication using `$ConnectionString` as username and the connection string as password provided in the already created `eventhubssecret`.
The `tls` section is used because Event Hub connection [needs SSL](https://docs.microsoft.com/en-gb/azure/event-hubs/event-hubs-for-kafka-ecosystem-overview?WT.mc_id=devto-blog-abhishgu#security-and-authentication) with `SASL_SSL` as security protocol

Create the `KafkaMirrorMaker` on the Kubernetes cluster saving the above resource into a `kafka-mirror-maker.yaml` file.
The Strimzi cluster operator takes care of it deploying Kafka Mirror Maker using the above configuration.

```shell
kubectl apply -f kafka-mirror-maker.yaml -n kafka
```

### Produce, mirror and trigger!

For the purpose of this demo, the application consuming the mirrored messages from Event Hub is a simple Azure Functions application which just gets and logs the message.

```java
/**
 * Azure Functions with Event Hub trigger.
 */
public class StrimziEventHubTrigger {
    /**
     * This function will be invoked when an event is received from Event Hub.
     */
    @FunctionName("StrimziEventHubTrigger")
    public void run(
        @EventHubTrigger(name = "message", eventHubName = "<eventhubs-namespace>", connection = "EH_CONNECTION_STRING", consumerGroup = "$Default", cardinality = Cardinality.MANY) List<String> message,
        final ExecutionContext context
    ) {
        context.getLogger().info("Java Event Hub trigger function executed.");
        context.getLogger().info("Length:" + message.size());
        message.forEach(singleMessage -> context.getLogger().info(singleMessage));
    }
}
```

Even in this case the `<eventhubs-namespace>` has to be replaced with the Event Hub namespace to connect to and the `EH_CONNECTION_STRING` environment variable has to be defined in the JSON application settings file containing the connection string as already used for the Kafka Mirror Maker configuration.

For more information about Azure Functions connecting to Event Hub this [link](https://docs.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-hubs-trigger) provides really useful information.
The application can run locally or be published on the Azure cloud.

To try the entire pipeline, the only thing left to do is to send some messages.
Then we can see that they are mirrored to Event Hub, causing the above function to be executed.
To do so, just use the `kafka-console-producer` command line tool provided with Apache Kafka.
Start a new pod in the Kubernetes cluster for hosting the producer and type a couple of JSON messages as follows.

> They have to be JSON structured messages because the default Azure Functions deserializer expects this format

```shell
kubectl -n kafka run kafka-producer -ti --image=strimzi/kafka:0.17.0-kafka-2.4.0 --rm=true --restart=Never -- bin/kafka-console-producer.sh --broker-list my-cluster-kafka-bootstrap:9092 --topic testeh
If you don't see a command prompt, try pressing enter.
>{ "id": 1, "message": "Hello from Strimzi Mirror Maker" }
>{ "id": 2, "message": "Here another mirrored message" }
>
```

On the Azure Functions application, the messages will be logged like this:

```shell
[09/05/2020 14:02:17] Executing 'Functions.EventHubTriggerJava1' (Reason='', Id=6c54f1df-6a3d-4acc-a89a-4078b2049ddc)
[09/05/2020 14:02:22] Java Event Hub trigger function executed.
[09/05/2020 14:02:22] Length:1
[09/05/2020 14:02:22] {"id":1,"message":"Hello from Strimzi Mirror Maker"}
[09/05/2020 14:02:23] Function "EventHubTriggerJava1" (Id: 6c54f1df-6a3d-4acc-a89a-4078b2049ddc) invoked by Java Worker
[09/05/2020 14:02:23] Executed 'Functions.EventHubTriggerJava1' (Succeeded, Id=6c54f1df-6a3d-4acc-a89a-4078b2049ddc)
[09/05/2020 14:02:51] Executing 'Functions.EventHubTriggerJava1' (Reason='', Id=8edf21e3-94b3-4f4f-b2a7-8e92a311f9f0)
[09/05/2020 14:02:51] Java Event Hub trigger function executed.
[09/05/2020 14:02:51] Length:1
[09/05/2020 14:02:51] {"id":2,"message":"Here another mirrored message"}
[09/05/2020 14:02:51] Function "EventHubTriggerJava1" (Id: 8edf21e3-94b3-4f4f-b2a7-8e92a311f9f0) invoked by Java Worker
[09/05/2020 14:02:51] Executed 'Functions.EventHubTriggerJava1' (Succeeded, Id=8edf21e3-94b3-4f4f-b2a7-8e92a311f9f0)
```

### Conclusion

Integrating applications running on different platforms and different clouds is becoming quite common nowadays and the hybrid cloud based use cases are growing fast.
Back to the scenario showed in this blog post, the Apache Kafka cluster on Kubernetes could run on any cloud provider (Azure, Amazon, IBM, GCP) and thanks to the Strimzi operators, its deployment and management is fairly simple as well as mirroring data to other systems like Event Hub using Kafka Mirror Maker.

If you want to know how to do the same using the new Kafka Mirror Maker 2 or, even better, how to set up an "active-active" mirroring architecture, you can read more on this [blog post](https://strimzi.io/blog/2020/06/09/mirror-maker-2-eventhub/).

I hope this post has persuaded you of the benefit of using Strimzi for doing such an integration with Azure.
Let us know what you are going to integrate!