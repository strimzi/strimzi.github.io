---
layout: post
title:  "Tips & Tricks for running Strimzi with kubectl"
date: 2020-07-21
author: jakub_scholz
---

When running Apache Kafka on Kubernetes with Strimzi, one of the tools you might use very often is `kubectl`.
You can use it for controlling your Kubernetes cluster and its resources.
Because Strimzi is using custom resources to extend the Kubernetes APIs, you can also use `kubectl` with Strimzi.
In this blog post, we will have a look at some tips and tricks on how to make using `kubectl` with Strimzi easier.

<!--more-->

## Working with Kubernetes resources

`kubectl` can be used for all basic tasks with the Strimzi custom resources.
You can use all `kubectl` commands such as `get`, `describe`, `edit`, or `delete` coupled with the resource type.
So for example `kubectl get kafkatopics` will get you a list of all Kafka topics or `kubectl get kafkas` to get all Kafka clusters.

When referencing a resource types, you can use both singular and plural.
So `kubectl get kafkas` gets you the same results as `kubectl get kafka`.
But a lesser known feature is that you can reference custom resources with their _short name_.
The _short name_ for `Kafka` is `k`, so you can for example also run `kubectl get k` to list all your deployed `Kafka`s.

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


This is really handy because some of the resources have longer names. 
So learning the short names can save a lot of time while operating Strimzi or working on new features.

## Resource categories

The custom resources can be also grouped into categories.
The name of the category can be used in the `kubectl` commands instead of the individual resource types.
All Strimzi custom resources are in the category `strimzi`,
so you can use it to get all the Strimzi resources with one command.
For example running `kubectl get strimzi` will lists all the different Strimzi custom resources which exist in given namespace.
The output will look something like the following:

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
For example while developing or testing new Strimzi features, I quite often need to delete all Strimzi custom resources.
Doing it resource by resource would take a long time.
But I can delete them all in a single command:

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
The JSONPath expression can be used to extract or navigate specific parts of any resource.
For example, you can get the bootstrap address from the status of the Kafka custom resource and use it in your Kafka clients.
You can do that with the following JSONPath expression - `{.status.listeners[?(@.type=="tls")].bootstrapServers}`:

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

You can similarly extract any other field or group of fields from any custom resource.

## Conclusion

`kubectl` on first appearance looks like a simple tool, but it has also some very powerful features, useful for everyday development.
I hope this blog post will help you to be more efficient when managing Strimzi with the `kubectl` tool.
