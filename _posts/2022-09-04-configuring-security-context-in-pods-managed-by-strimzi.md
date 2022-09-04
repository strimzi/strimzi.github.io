---
layout: post
title: "Configuring security context of Strimzi-managed pods"
date: 2022-09-04
author: jakub_scholz
---

Security is important for all of us.
That is why we always try to do our best to make sure that our code doesn't contain any security vulnerabilities.
But you can never be sure that there are no unknown bugs which can be misused to gain access to you system.
And you never know whether the a new zero-day vulnerability will be announced tomorrow.
That is why it is important to also make sure that your applications have only the permissions and privileges they actually need.
On Kubernetes, one of the features which can be used to restrict what your applications can do are Pod and container security contexts.
And in this blog posts, we will have a look at how you can configure them with Strimzi.

<!--more-->

Kubernetes has two separate security contexts:
* Pod security context which is configured at the Pod level and is applied to all containers in given Pod
* Container security context which is configured at the container level and applies only to given container

You can read more about the security context [Kubernetes documentation](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
In Strimzi, you can already for a long time configure the security context in the template section of the different custom resources.
The following example shows how you can configure the contexts of the Apache Kafka brokers in the `Kafka` custom resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  # ...
  kafka:
    template:
      pod:
        # Pod Security Context
        securityContext:
          runAsUser: 1000001
          fsGroup: 0
      kafkaContainer:
        # Container security context of the Apache Kafka broker container
        securityContext:
          runAsUser: 2000
  # ...
```

This gives you a lot of flexibility because you can configure different security context for every pod or container.
But it also means you have to configure it on many different places.
Depending on your configuration, your Apache Kafka cluster can have up to 5 different pods with up to 7 containers.
And your Connect, Bridge or Mirror Maker deployments might add more.
So you need to configure the security context for each of them.

## Pod Security Providers

To make this easier, Strimzi 0.31.0 introduces Pod Security Providers.
Pod Security Providers can help you configure the security context for all Strimzi-managed Pods and containers from one place.
You can configure the Pod Security Provider in the Cluster operator configuration using the environment variable `STRIMZI_POD_SECURITY_PROVIDER_CLASS`.
Strimzi provides two different providers:
* Baseline provider
* Restricted provider

These providers correspond to the _baseline_ and _restricted_ profiles as defined in the [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/).

### Baseline provider

The Baseline provider is the default provider which is used when you don't configure any other provider.
If you want, you can also enable it explicitly by setting the `STRIMZI_POD_SECURITY_PROVIDER_CLASS` environment variable to `io.strimzi.plugin.security.profiles.impl.BaselinePodSecurityProvider`.
Alternatively, you can also use the _shortcut_ `baseline`.
The Baseline provider configures the Strimzi managed pods according to the [Kubernetes _baseline_ profile](https://kubernetes.io/docs/concepts/security/pod-security-standards/#baseline).
It also provides backwards compatibility because it configures the pods in exactly the same way as previous Strimzi versions.
So with this provider, there will be no change to how the Strimzi-managed pods are configured.

### Restricted provider

The Restricted provider can be enabled by setting the `STRIMZI_POD_SECURITY_PROVIDER_CLASS` environment variable to `io.strimzi.plugin.security.profiles.impl.RestrictedPodSecurityProvider`.
Or you can also use the _shortcut_ keyword `restricted`:

```yaml
# ...
env:
  # ...
  - name: STRIMZI_POD_SECURITY_PROVIDER_CLASS
    value: io.strimzi.plugin.security.profiles.impl.RestrictedPodSecurityProvider
  # ...
```

The Restricted provider configures the Strimzi managed pods according to the [Kubernetes _restricted_ profile](https://kubernetes.io/docs/concepts/security/pod-security-standards/#restricted).
The _restricted_ profile reduces the number of different permissions your applications can use:
* Restricts the volume types which can be used
* Does not allow privilege escalation
* Requires applications to run under a non-root user
* The _Seccomp_ profile must be set to `RuntimeDefault` or `Localhost`
* Containers must drop all capabilities and can use only the `NET_BIND_SERVICE` capability

All of these requirements are implemented in our restricted provider.
When you enable it in the Cluster Operator, all containers it creates will have the following security context set:

```yaml
# ...
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
# ...
```

Any Pods and containers which will be already deployed and running when you enable the restricted provider will be rolled and the security context will be set for them as well.

The [Kafka Connect Build](https://strimzi.io/docs/operators/latest/full/deploying.html#creating-new-image-using-kafka-connect-build-str) feature which allows a new Apache Kafka Connect container with additional connectors to be automatically build requires the Kaniko container builder to run as a root user.
Therefore it cannot be used with the restricted provider.
You can create your custom container with the additional connectors by [writing your own `Dockerfile`](https://strimzi.io/docs/operators/latest/full/deploying.html#creating-new-image-from-base-str) and building the container manually or in your CI/CD pipelines.

### Mixing the different configurations

The Pod Security Providers can be also combined with the security context configuration in the `template` sections of the Strimzi custom resources which we covered at the beginning of this blog post.
The security context configured through the `template` has always higher priority then the Pod Security Provider.
Thanks to that, you combine these two options.
You can for example use the Restricted provider to automatically configure the security context for most containers.
But use the `template` to set some very specific context for a container where you need to use some custom configuration. 

### Compatibility with different Kubernetes distributions

Your Kubernetes cluster might have its own way how to deal with the security context.
It is for example possible that it has some tooling which injects the security context on its own.
This can be done through some additional tooling or might be directly built-in into your Kubernetes distribution.
One such example if Red Hat OpenShift which has its own own mechanisms for injecting the security contexts on the fly.
In such case, you usually don't need use the Strimzi Pod Security Profiles, you can just ignore them and let your Kubernetes distribution _do its magic_.

### Implementing your own Pod Security Provider

The Pod Security Provider mechanism can be also used to write your own providers.
So if the two providers shipped as part of Strimzi do not match your needs, you can write your own provider which configures the security context exactly as you wish.
You can then build it into a JAR and add it to the Cluster Operator container image.
And once it is in the container, you can just set the `STRIMZI_POD_SECURITY_PROVIDER_CLASS` environment variable to your provider.

In this blog post, we will not get into the details of writing your own provider.
But if you want, you can check the [existing implementations](https://github.com/strimzi/strimzi-kafka-operator/tree/main/api/src/main/java/io/strimzi/plugin/security/profiles/impl) for inspiration.
Your custom provider can either implement the [`PodSecurityProvider` interface](https://github.com/strimzi/strimzi-kafka-operator/blob/main/api/src/main/java/io/strimzi/plugin/security/profiles/PodSecurityProvider.java) or just extend one of the [existing classes](https://github.com/strimzi/strimzi-kafka-operator/tree/main/api/src/main/java/io/strimzi/plugin/security/profiles/impl).
The providers are loaded using the [Java Service Provider Interface](https://www.baeldung.com/java-spi), so do not forget to also create the [provider configuration file](https://github.com/strimzi/strimzi-kafka-operator/blob/main/api/src/main/resources/META-INF/services/io.strimzi.plugin.security.profiles.PodSecurityProvider) which is used for the discovery.

## What about the operator?

The Pod Security Provider plugins are used to configure security context for the Pods and containers created by the Strimzi Cluster Operator.
But what about the Cluster Operator itself?
The Cluster Operator deployment by default does not have any special security context set.
That means that out of the box it runs under the Kubernetes `baseline` profile.
But if you want, the operator can run under the `restructed` profile as well.
You can simply edit the Deployment and configure the security context:

```yaml
# ...
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
# ...
```

You can also configure the security context when deploying the [Cluster Operator using Helm](https://github.com/strimzi/strimzi-kafka-operator/blob/main/helm-charts/helm3/strimzi-kafka-operator/README.md#configuration).

## What is the right default?

For the time being, we decided to not to use the `restricted` security profile by default.
The main reason for that was backwards compatibility with previous Strimzi versions.
We wanted to avoid causing problems to existing users when they upgrade to Strimzi 0.31.0.
In the future - as the support improves in the different Kubernetes distributions - we might reevaluate this decision.
But at least for the time being, you have now a convenient option to run under the `restricted` Kubernetes security profile.
