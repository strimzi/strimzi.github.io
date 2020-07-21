---
layout: post
title:  "Tips & Tricks for running Strimzi with `kubectl`"
date: 2020-07-21
author: jakub_scholz
---

When running Apache Kafka on Kubernetes with Strimzi, one of the tools you might use very often is `kubectl`.
You can use it for controlling your Kubernetes cluster and its resources.
And because Strimzi is using Custom Resources to extend the Kubernetes APIs, it can use it also with Strimzi.
In this blog post, we will have a look at some tips and tricks how to make it easier.

<!--more-->

## Working with Kubernetes resources

`kubectl` can be used for all the basic tasks with the Strimzi custom resources.
You can use all `kubectl` commands such as `get`, `describe`, `edit`, or `delete` coupled with the resource type.
So for example `kubectl get kafkatopics` will get you a list of all Kafka topics or `kubectl get kafkas` to get all Kafka clusters.

Most people know that for all of the resource types, you can use both singular and plural.
So `kubectl get kafkas` gets you the same results as `kubectl get kafka`.
But not everyone knows that the custom resources have also _short name_.
So you can for example also do `kubectl get k`.

```
$ kubectl get k
NAME         DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS
my-cluster   3                        3
```

The following table shows all our resources and their short names:

| Resource              | Long name         | Short name    |
| --------------------- |:----------------- |:------------- |
| Kafka                 | kafka             | k             |
| Kafka Topic           | kafkatopic        | kt            | 
| Kafka User            | kafkauser         | ku            |
| Kafka Connect         | kafkaconnect      | kc            |
| Kafka Connect S2I     | kafkaconnects2i   | kcs2i         |
| Kafka Connector       | kafkaconnector    | kctr          |
| Kafka Mirror Maker    | kafkamirrormaker  | kmm           |
| Kafka Mirror Maker 2  | kafkamirrormaker2 | kmm2          |
| Kafka Bridge          | kafkabridge       | kb            |
| Kafka Rebalance       | kafkarebalance    | kr            |

This is really handy because some of the resources have really long names. 
So learning the short names can save a lot of time while operating Strimzi or working on new features.

## Resource categories

The custom resources can be also grouped into categories.
The name of the category can be used in the `kubectl` commands instead of the individual resource types.
All our custom resources are in the category `strimzi`.
You can use it for example to get all the Strimzi resources with one command.
For example something like `kubectl get strimzi` which lists all the different Strimzi resources which exist in given namespace.

```
$ kubectl get strimzi
NAME                                DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS
kafka.kafka.strimzi.io/my-cluster   3                        3

NAME                                          PARTITIONS   REPLICATION FACTOR
kafkatopic.kafka.strimzi.io/kafka-test-apps   3            3

NAME                                 AUTHENTICATION   AUTHORIZATION
kafkauser.kafka.strimzi.io/my-user   tls              simple
```

You can also combine this with other commands.
For example while developing or testing new Strimzi features, I quite often need to delete all Strimzi resources.
Doing it resource by resource would take a long time.
But I can do it all in a single command:

```
$ kubectl delete $(kubectl get strimzi -o name)
kafka.kafka.strimzi.io "my-cluster" deleted
kafkatopic.kafka.strimzi.io "kafka-test-apps" deleted
kafkauser.kafka.strimzi.io "my-user" deleted
```

The inner command - `kubectl get strimzi -o name` - will return the types and the resource names.
This is enabled by the `-o name` option.

```
$ kubectl get strimzi -o name
kafka.kafka.strimzi.io/my-cluster
kafkatopic.kafka.strimzi.io/kafka-test-apps
kafkauser.kafka.strimzi.io/my-user
```

And when this is passed into the `kubectl delete` command, it will delete all Strimzi resources.

## Querying the status subresources

We already saw how the `-o name` option can be used to get the output in the `type/name` format.
There are also other values you can pass to the `-o` option.
For example by using `-o yaml` you can get the output in YAML format.
Or `-o json` will return it as JSON.
You can see all the options in `kubectl get --help` or in the [`kubectl` docs](https://kubernetes.io/docs/reference/kubectl/overview/#formatting-output).

One of the most useful options is `jsonpath`.
It allows you to pass [JSONPath](https://kubernetes.io/docs/reference/kubectl/jsonpath/) expression which will be evaluated while querying the Kubernetes API.
The JSONPath expression can be used to extract specific parts of the custom resource.
For example, you can easily get the bootstrap address from the status of the Kafka custom resource and use it in your Kafka clients.
You can do that in the following JSONPath expression - `{.status.listeners[?(@.type=="tls")].bootstrapServers}`:

```
$ kubectl get kafka my-cluster -o=jsonpath='{.status.listeners[?(@.type=="tls")].bootstrapServers}{"\n"}'
my-cluster-kafka-bootstrap.myproject.svc:9093
```

The command above will find the `bootstrapServers` value of the `tls` listeners.
By changing the type condition to `@.type=="external"` or `@.type=="plain"` you can also get the address of the other Kafka listeners.

```
$ kubectl get kafka my-cluster -o=jsonpath='{.status.listeners[?(@.type=="external")].bootstrapServers}{"\n"}'
192.168.1.247:9094
```

You can similarly extract also all the other fields from any custom resource.

## Conclusion

`kubectl` seems to be on the first look a simple tool.
But it has also some very powerful features.
And in combination with custom resources it can be very useful.
I hope this blog post will help you to be more efficient when managing Strimzi with `kubectl`.
