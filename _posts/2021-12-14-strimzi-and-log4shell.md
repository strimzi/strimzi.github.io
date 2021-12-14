---
layout: post
title:  "Strimzi and Log4Shell (Log4j2 CVE-2021-44228)"
date: 2021-12-14
author: jakub_scholz
---

The [CVE-2021-44228](https://nvd.nist.gov/vuln/detail/CVE-2021-44228) vulnerability in the [Log4j2 logging library](https://logging.apache.org/log4j/2.x/) - also known as Log4Shell - affects many software projects written in Java.
Several Strimzi components and dependencies use Log4j2 as well.
A lot has been written about how the vulnerability works and how it can be used by attackers to gain control over your system.
We will not get into the details in this blog post.
But in short, if an attacker can get your application to log some arbitrary log message (or part of it), it can be used to execute arbitrary code, loaded from an attacker-controlled remote server, inside your application.
In this blog post, we will have a look at which parts of your Strimzi deployment might be affected and how the vulnerability can be mitigated.

<!--more-->

## Is Strimzi affected?

When using Strimzi, you first deploy the Cluster Operator as the central component.
Then you use it to deploy the operands.
Finally, each operand might consist of multiple different components.
For example when you deploy the Kafka cluster using the `Kafka` custom resource, it does not deploy just the Kafka brokers.
It also deploys the ZooKeeper cluster, the topic and user operators and possibly also Cruise Control or Kafka Exporter.
There are also some components which are deployed separately, such as the Drain Cleaner.

The following list provides all the available components:
* Cluster Operator
* Topic Operator
* User Operator
* Strimzi Kafka Bridge
* Strimzi Drain Cleaner
* Strimzi Canary
* Kafka brokers
* ZooKeeper nodes
* Kafka Connect
* Kafka Mirror Maker 1
* Kafka Mirror Maker 2
* Cruise Control
* Kafka Exporter
* TLS sidecars
* Kaniko container builder

Let's have a look at these components and identify those which are and are not affected by the Log4j2 vulnerability.

### Unaffected components

Several of the components are not affected because they do not use Java at all.
This includes the [Kafka Exporter](https://github.com/danielqsj/kafka_exporter) and [Strimzi Canary](https://github.com/strimzi/strimzi-canary) which are written in Golang.
The [Kaniko builder](https://github.com/GoogleContainerTools/kaniko) used to build the Kafka Connect images is also written in Golang
The TLS sidecars used in the Cruise Control and Entity Operator are based on [Stunnel](https://www.stunnel.org/) which is written in C.

The last unaffected component is the [Strimzi Drain Cleaner](https://github.com/strimzi/drain-cleaner).
The Drain Cleaner is written in Java, but it uses Log4j2 library only in tests and not when used by the users.
The next release of Drain Cleaner will contain the Log4j2 fix (for these tests) as well.
But until then, you do not need to be worried if you use Drain Cleaner in your environment.

### Affected components

That leaves the five affected components.
All Strimzi operators up-to (including) version 0.26.0 use Log4j2.
So does the Strimzi Kafka Bridge up-to (including) version 0.20.3.
The versions of [Cruise Control](https://github.com/linkedin/cruise-control) used by Strimzi operators from 0.22.0 up until 0.26.0 are affected as well.

The operators and Cruise Control are normally accessible only internally within your Kubernetes cluster.
We are currently not aware of any way of exploiting the vulnerability, either through Apache Kafka or directly.
But we cannot exclude such possibility.

The Strimzi Kafka Bridge is used to access the Kafka cluster using HTTP or AMQP protocols.
As such, it is often exposed to more open networks and environments which makes it vulnerable.

### What about Kafka?

[Apache Kafka project](https://kafka.apache.org/) is currently using the [Log4j 1 library](https://logging.apache.org/log4j/1.2/).
This is a predecessor of Log4j2 and is not affected by CVE-2021-44228.
This includes not just the Kafka brokers, but also ZooKeeper, Kafka Connect and Mirror Maker 1 & 2.

While in this case using Log4j 1 proved useful, its usage has its own problems.
Log4j 1 is no longer maintained and has its own CVEs which are not as critical as CVE-2021-44228.
The Apache Kafka project is working on replacing it with Log4j2 in the future.

One of the CVEs in Log4j 1 is [CVE-2021-4104](https://nvd.nist.gov/vuln/detail/CVE-2021-4104) which is very similar to the Log4Shell CVE.
But there is one main difference - it affects Log4j 1 only when you use the `JMSAppender` with some specific configuration.
The `JMSAppender` is not used by default.
So make sure you did not enabled it in your Kafka or ZooKeeper logging configuration and you should not be affected by it.

## Mitigation

There are two different ways that you can mitigate the vulnerability with Strimzi.
The Log4j2 project released a new version 2.15.0 of their library which fixes the CVE.
Using this new version of Log4j2 in your environments is the best way to address the vulnerability.
An alternative way is to disable the remote lookups in the older versions of the Log4j2 library.

### Upgrade Strimzi

After finding out about the CVE, we started to work on fixing this vulnerability in our projects by including the new - fixed - version of Log4j.
We have released new version [0.21.0](https://github.com/strimzi/strimzi-kafka-bridge/releases/tag/0.21.0) of the Strimzi Kafka Bridge which uses the new version of the library and should be safe to use.
We also released new version [0.26.1](https://github.com/strimzi/strimzi-kafka-operator/releases/tag/0.26.1) of our operators which includes the new version of the bridge.
It uses the new Log4j2 version 2.15.0 in all Strimzi operators.
And it updates the Log4j2 version in the Cruise Control deployment as well.

**We recommend you to upgrade to this new versions of Strimzi as soon as possible.**

Of course, the fixes will also be in the upcoming 0.27.0 release.

### Alternatives

If, for some reason, you cannot upgrade to Strimzi Kafka Operators 0.26.1 and Strimzi Kafka Bridge 0.21.0, you can try to mitigate the issue by disabling the JNDI lookups.
You can do that by setting the Java system property `log4j2.formatMsgNoLookups` to `true`.
Different Strimzi components have different ways to set this option.

#### Cluster Operator

For the Cluster Operator, you can edit the Kubernetes deployment and add a new environment variable `JAVA_OPTS` with value `-Dlog4j2.formatMsgNoLookups=true`.
Once you apply these changes, Kubernetes will roll the operator pod and use this option.
The following example snippet shows how the Deployment with the new environment variable:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: strimzi-cluster-operator
spec:
  # ...
  template:
    # ...
    spec:
      # ...
      containers:
        - name: strimzi-cluster-operator
          # ...
          env:
            # ...
            - name: JAVA_OPTS
              value: "-Dlog4j2.formatMsgNoLookups=true"
            # ...
  strategy:
    type: Recreate
```

If you installed Strimzi using Operator Hub, you cannot just edit the operator deployment because any changes you make will be reverted by the Operator Hub.
But you can set custom environment variables in [the `Subscription` resource](https://github.com/operator-framework/operator-lifecycle-manager/blob/master/doc/design/subscription-config.md#env).

The Helm Chart of Strimzi 0.26 doesn't have an option to configure custom environment variables.
But in many cases, you should be able to add the environment variable to the deployment after it was created by the Helm Chart.
You can also edit the Deployment template which is inside the Helm Chart to add the environment variable to it before deploying the Helm Chart.

#### Topic and User Operators

For Topic and User operators, you can set the system property using the `Kafka` custom resource and its `jvmOptions`.
Topic and User operator run in the same pod, but they have each their own container.
So remember that you have to set it for both of them:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  labels:
    app: my-cluster
spec:
  # ...
  entityOperator:
    userOperator:
      # ...
      jvmOptions:
        javaSystemProperties:
          - name: log4j2.formatMsgNoLookups
            value: "true"
    topicOperator:
      # ...
      jvmOptions:
        javaSystemProperties:
          - name: log4j2.formatMsgNoLookups
            value: "true"
  # ...
```

#### Cruise Control

For Cruise Control, you can pass the system property through the `Kafka` custom resource as well.
But this time, using the `template` section where we add the system property into the `KAFKA_OPTS` environment variable:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
  labels:
    app: my-cluster
spec:
  # ...
  cruiseControl:
    # ...
    template:
      cruiseControlContainer:
        env:
          - name: KAFKA_OPTS
            value: -Dlog4j2.formatMsgNoLookups=true
  # ...
```

If you did not enabled Cruise Control in your Kafka cluster, you can of course just skip this step.

#### Strimzi Kafka Bridge

For Strimzi Kafka Bridge, the system property can be passed as environment variable as well.
But for Bridge, we have to use `JAVA_OPTS`:

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
        - name: JAVA_OPTS
          value: -Dlog4j2.formatMsgNoLookups=true
```

#### Verification

After you apply all the changes, you might want to verify that they are really being used.
One of the ways you can do it is to exec into the running pod and check the running processes.
In most of the containers, you should see a process like this:

```
exec /usr/bin/tini -w -e 143 -- java ...
```

And somewhere there, after the `java` keyword, you should see the options passed to the Java application.
If you do not see the system property there, you should probably double check the configuration to make sure that you didn't make any typos and that the YAML is correctly aligned.

## Conclusion

Bugs and CVEs are inseparable part of any software project.
We all hope that another CVE which is as critical and as widespread as this doesn't show up for a long time.
But there will be for sure new bugs and new CVEs.

When you have concerns about any CVEs affecting the Strimzi dependencies or container images, feel free to get in touch with us over our [mailing list](https://lists.cncf.io/g/cncf-strimzi-users/topics), [Slack](https://slack.cncf.io/) or on [GitHub](https://github.com/strimzi/strimzi-kafka-operator/discussions).
Following these channels will also help to get information about new issues as quickly as possible.

If you think there is a CVE directly in the Strimzi code itself, you can also contact us privately by sending email to the maintainers mailing list [cncf-strimzi-maintainers@lists.cncf.io](mailto:cncf-strimzi-maintainers@lists.cncf.io).
