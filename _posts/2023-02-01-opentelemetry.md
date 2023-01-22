---
layout: post
title: "Apache Kafka tracing with Strimzi: from OpenTracing to OpenTelemetry"
date: 2023-02-01
author: paolo_patierno
---

Apache Kafka is one of the most used platforms for events and data streaming to build a distributed system, by providing the backbone for microservices communication.
One of the most complex tasks to deal with such a distributed environment, is to get insights about the flow of the data and then evaluating performance.
This is where distributed tracing comes into the picture, by addressing different issues:

* monitor the flow of events or remote procedure calls between applications.
* profile messages latency in order to help optimizing performance.
* provide an overall picture about how microservices communicate across boundaries.

Strimzi have been provided tracing support, for Kafka Connect, Kafka Mirror Maker(s) and the HTTP bridge, since the 0.14.0 release leveraging the [OpenTracing](https://opentracing.io/) project. Tracing is anyway not supported for Kafka brokers.
But since then, the distributed tracing ecosystem has changed, the OpenTracing project was archived and replaced by a new project, [OpenTelemetry](https://opentelemetry.io/).

This blog post will show you, how to use OpenTelemetry within the Strimzi project and what are the differences with OpenTracing which is now deprecated and will be removed in the coming months.

## What is OpenTelemetry?

OpenTelemetry is an open source and vendor neutral project providing tools, APIs, and SDKs used to generate, collect and export telemetry data.
It is part of the Cloud Native Computing Foundation and it is available across several languages.
It is not just about tracing but it has support for metrics and logs as well.

> The Strimzi project supports with OpenTelemetry is about tracing only. There are no actual plans to add metrics and logs support in the future.

While the OpenTracing project is strictly tight to the Jaeger implementation, by using the Jaeger client underneath, OpenTelemetry provides a different approach.
The tracer uses an exporter in order to export traces in a specific format to the backend system.
While a Jaeger based exporter is available, to allow current users to continue using the Jaeger protocol, the OTLP (OpenTeLemetry Protocol) one is used by default and the OpenTelemetry community encourage to move to it.
You can also use Zipkin or developing your own exporter for a custom backend system.

Using a specific exporter protocol means that the corresponding backend system has to support it.
It has to provide an endpoint to which the traces are sent by using that specific protocol.
For example, you can still use Jaeger backend with the OTLP exporter protocol, because newer Jaeger releases since 1.35 exposes an OTLP endpoint.
You could also decide to use the usual Jaeger protocol endpoint by setting the corresponding Jaeger exporter in your system.

From an application perspective, the way OpenTelemetry works is similar to OpenTracing (using Jaeger client).
The tracer is part of your application and it provides the API for creating trace spans and using the configured exporter to send them.
Focusing on Apache Kafka, the application could be a producer or consumer, or one of the components managed by the Strimzi operator, such as Kafka Connect, Kafka Mirror Maker(s) and the HTTP bridge.

As it happens with OpenTracing, even the OpenTelemetry exporter doesn't send all traces but often just part of them by using sampling.
The sampler mechanism can be configured through environment variables.

## How to enable OpenTelemetry

Before adding the support for OpenTelemetry, it was already possible to enable the distributed tracing on the `KafkaConnect`, `KafkaMirrorMaker`, `KafkaMirrorMaker2` and `KafkaBridge` custom resources by setting the `spec.tracing.type` property to `jaeger` to use OpenTracing.
Since the Strimzi 0.32.0 release, you can set the corresponding `opentelemetry` value for using OpenTelemetry instead.

```yaml
# ...
spec:
  # ...
  tracing:
    type: opentelemetry
  # ...  
```

With the above setting, the Strimzi operator initializes the OpenTelemetry tracer using the default OTLP exporter, for sending traces to the tracing backend.
But you also need to specify environment variables to configure the exporter itself, by using the `spec.template` properties.
Following, an example of the `KafkaBridge` configuration.

```yaml
spec:
  #...
  template:
    bridgeContainer:
      env:
        - name: OTEL_SERVICE_NAME
          value: my-otel-service
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: "http://jaeger-host:4317"
  tracing:
    type: opentelemetry
```

It is using the service name `my-otel-service` which will show up in the backend UI.
Assuming, for example, you are using Jaeger backend, it configures the tracer to send the traces to the `http://jaeger-host:4317` OTLP endpoint on the backend.
By default, the exporter uses the OTLP protocol which has to be enabled on the Jaeger backend.
If you want to change to a different exporting protocol, for example using the `jaeger` one, set the `OTEL_TRACES_EXPORTER` environment variable as well but you also need to add the corresponding artifact in the Kafka image. More details about how to do that in the official documentation [here](https://strimzi.io/docs/operators/latest/deploying.html#proc-enabling-tracing-type-str).
You would also need to set the `OTEL_EXPORTER_JAEGER_ENDPOINT` instead of the above `OTEL_EXPORTER_OTLP_ENDPOINT` to specify a Jaeger protocol endpoint.

>  If you are using Jaeger as the backend system for tracing, you need to have 1.35 release at least which is the first one exposing an OTLP endpoint. More details at the official Jaeger documentation [here](https://www.jaegertracing.io/docs/1.41/getting-started/) about starting the backend with the `COLLECTOR_OTLP_ENABLED` environment variable set.

## OpenTelemetry in action

Assuming you already have the Strimzi operator running on your Kubernetes instance, together with an Apache Kafka cluster, the first step is to install a tracing backend to get the traces from your applications.
As already mentioned, the Jaeger backend can still be used together with the OTLP endpoint enabled, so let's use this one.

#### Installing Jaeger backend

The easiest way to deploy the Jaeger backend on Kubernetes is to use the Jaeger Operator.
One of the pre-requisites for the latest releases is having the cert-manager already installed as well.

The cert-manager installation is just about running the following command:

```shell
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.6.3/cert-manager.yaml
```

After that, install the Jaeger Operator in the `observability` namespace:

```shell
kubectl create namespace observability
kubectl create -f https://github.com/jaegertracing/jaeger-operator/releases/download/v1.41.0/jaeger-operator.yaml -n observability
```

With the Jaeger Operator up and running, you can now create a `Jaeger` custom resource describing the Jaeger instance to install.
Following, the simplest `Jaeger` definition which is enough for our purposes:

```yaml
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: simplest
```

Create a `simplest.yaml` file with the above declaration and install it:

```shell
kubectl apply -f simplest.yaml
```

With the Jaeger instance running, an OTLP endpoint for getting the traces is exposed through the `http://simplest-collector:4317` service.

> If using Minikube, you can use the port-forwarding to have access to the Jaeger Web UI easily from your local browser at `http://localhost:16686`. Just use the corresponding command `kubectl port-forward svc/simplest-query 16686:16686`.

For more details, the official Jaeger documentation explains all the steps [here](https://www.jaegertracing.io/docs/latest/operator/).

## Let's trace the HTTP bridge traffic

Let's take the Strimzi HTTP bridge as an example of tracing to show how OpenTelemetry works.
The first step is to deploy a `KafkaBridge` instance with the tracing enabled and the corresponding environment variables to configure the OTLP exporter.

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaBridge
metadata:
  name: my-bridge
spec:
  replicas: 1
  bootstrapServers: my-cluster-kafka-bootstrap:9092
  http:
    port: 8080
  template:
    bridgeContainer:
      env:
        - name: OTEL_SERVICE_NAME
          value: my-otel-service
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: http://simplest-collector:4317
  tracing:
    type: opentelemetry
```

With the HTTP bridge up and running, we can use any HTTP client for sending and receiving messages.
It could be a simple command line tool like `cURL`, a more UI oriented like [Postman](https://www.postman.com/) or whatever is your preferred one.
You could also use an application you developed with your preferred language.
For the purpose of this blog post, I used Postman by having a producer sending a couple of messages and the consumer getting them.

When the HTTP clients exchange the messages we can see the traces and the corresponding spans in the Jaeger Web UI.

![](/assets/images/posts/2023-02-01-opentelemetry-01.png)

In the above picture, the HTTP producer sent two messages and they are received by the HTTP consumer.

When the HTTP client sends a producer request, the bridge generates two spans linked together as part of the same trace:

* the first span defines the HTTP `send` operation requested by the client. This span is created by the bridge application itself instrumented with OpenTelemetry.
* the second span defines the low level Kafka `send` on the `my-topic` topic which is a "CHILD_OF" the first one. This span is created by the instrumented Kafka client provided by the OpenTelemetry project. It uses a producer interceptor for creating the span.

![](/assets/images/posts/2023-02-01-opentelemetry-02.png)

In the same way, when the HTTP client send a poll request for receiving the messages, the bridge generates three spans linked together as part of the same trace:

* the first span defines the HTTP `poll` operation requested by the client. This span is created by the bridge application itself instrumented with OpenTelemetry.
* the second and third spans define the low level Kafka `receive` on the `my-topic` topic related to the messages received. They are both "CHILD_OF" the first span but at the same time they are referencing the external trace related to the producer with a "FOLLOW_FROM" relationship. These spans are created by the instrumented Kafka client provided by the OpenTelemetry project. It uses a consumer interceptor for creating them.

![](/assets/images/posts/2023-02-01-opentelemetry-03.png)

It is interesting to highlight that, due to the asynchronous nature of the communication between producer and consumer through the HTTP bridge and Kafka, the producing and consuming parts are traced with two different traces.
The consuming related spans are linked to the producing trace spans by using a "FOLLOW_FROM" relationship.
This takes into account that same messages could be consumed by multiple consumers or read again by the same consumer in the future.
Having different consumer traces linked to the producer one makes more sense than having an heavy and not so easy to navigate bigger trace.

## Kafka Connect, Mirror Maker(s) and clients

As already mentioned before, Strimzi supports tracing on Kafka Connect and Mirror Maker(s) components other than the HTTP bridge.
In this blog [post](https://strimzi.io/blog/2019/10/08/strimzi-apache-kafka-and-tracing/) we already covered them by using OpenTracing at that time.
In order to use OpenTelemetry instead, the set up is quite the same with the following changes:

* the `spec.tracing.type` has to be `opentelemetry`.
* the environment variables to be set in the `spec.template` are the ones related to OpenTelemetry as by the HTTP bridge example.

By using Jaeger as backend, you will get the traces the same way as described in the older blog post.

Of course, OpenTelemetry can be used to add tracing to your application as well.
The purpose is about having end-to-end tracing information from producer to consumer, not only related to the components where the messages are flowing through (i.e. HTTP bridge).
This is not something Strimzi specific but it is mostly about using the OpenTelemetry instrumentation libraries.
In order to help community users to a smoother approach on instrumenting their application, you can find more details on the Strimzi documentation about [Initializing tracing for Kafka clients](https://strimzi.io/docs/operators/latest/deploying.html#proc-configuring-tracers-kafka-clients-str).
The documentation guide your through instrumenting Kafka client API based applications as well as Kafka Streams ones.

You can also read more on this blog [post](https://opentelemetry.io/blog/2022/instrument-kafka-clients/) on the official OpenTelemetry website.

## Conclusion

Evaluating performance and getting insights about issues in a distributed system is a really complex task.
This is where distributed tracing helps.
After the OpenTracing project was archived, the CNCF community moved to a new shiny project, OpenTelemetry.
Strimzi is already moving forward on that direction, by deprecating OpenTracing and providing you support for OpenTelemetry.
We encourage you to move as soon as possible.
In the coming months, the OpenTracing support will be removed from all the Strimzi components and OpenTelemetry will be the only one.
For any kind of problems don't hesitate to get in touch with the Strimzi community, we'll be happy to help you!
