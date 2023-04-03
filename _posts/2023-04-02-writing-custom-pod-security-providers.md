---
layout: post
title: "Writing custom Pod Security Providers"
date: 2023-04-02
author: jakub_scholz
---

In Strimzi 0.31.0, we introduced Pod Security Providers.
They provide a pluggable mechanism for configuring the Pod and container security context of the operands managed by Strimzi.
In one of our previous [blog posts](https://strimzi.io/blog/2022/09/09/configuring-security-context-in-pods-managed-by-strimzi/), we explained how they work and introduced the two default implementations which are part of Strimzi itself.
And in this blog post, we will focus on how you can write your own custom Pod Security Providers.

<!--more-->

### Prerequisites

Strimzi is written in Java and the custom Pod Security Providers use Java as well.
This blog post expects that you have at least some basic knowledge of Java and the Maven build system.

If you want to try it out yourself either using the provided example or by writing your provider, you will need to have Java (Strimzi is using Java 17) and Maven installed on your computer.
To be able to add your custom provider to the Strimzi container image, you will also need to have a [Docker](https://www.docker.com/products/docker-desktop/) (or one of the Docker alternatives such as [Podman](https://podman.io/)) installed.
And finally, you will need to have a container registry to store the newly built container image.
It can be a private container registry that is part of your Kubernetes platform or for example a [Docker Hub](https://hub.docker.com/) or [Quay.io](https://quay.io/) account.

### Writing custom providers

The `PodSecurityProvider` interface as well as the provided Strimzi implementations are part of the Strimzi `api` module.
This is the same module that you can also use to manage the Strimzi-based infrastructure which we covered in [another blog post](https://strimzi.io/blog/2022/08/03/stimzi-based-infrastructure-as-a-java-code/)
We have to add this module to our Maven project and its `pom.xml`.
The `api` module is available in the central Maven repositories.
So all you need to do is to add it as a dependency:

```xml
    <dependencies>
        <dependency>
            <groupId>io.strimzi</groupId>
            <artifactId>api</artifactId>
            <version>0.34.0</version>
        </dependency>
    </dependencies>
```

The version of the module should match the Strimzi version you are using and with which you plan to deploy it.

Once you add the `api` module as a dependency, you can start coding.
There are two ways how you can write your custom provider.
You can start from scratch and implement the `PodSecurityProvider` interface.
Or you can take an existing provider and modify it by extending it.

#### Implementing the `PodSecurityProvider` interface

When you decide to implement your custom Pod Security Provider from scratch, the best way to do it is to implement the [`PodSecurityProvider` interface](https://github.com/strimzi/strimzi-kafka-operator/blob/main/api/src/main/java/io/strimzi/plugin/security/profiles/PodSecurityProvider.java).
This interface contains several different methods which will need to be implemented in your code.
In this example, we will implement a provider which will configure all containers to use a read-only root filesystem.
Read-only root filesystem means that the filesystem of the container image will be always read-only and the containers will be able to write only to folders mounted as volumes in the Pod definition.

To get started, we create a new class `CustomPodSecurityProvider` and let it implement the `PodSecurityProvider`

```java
package cz.scholz.providers;

// Imports

public class CustomPodSecurityProvider implements PodSecurityProvider {
    // Implemented interface methods
}
```

The first method is the `configure(...)` method which is called when the provider is loaded and can be used to configure and initialize the provider.
This method consumes as a single parameter a [`PlatformFeatures` object](https://github.com/strimzi/strimzi-kafka-operator/blob/main/api/src/main/java/io/strimzi/platform/PlatformFeatures.java).
You can use this object to find out more about the environment in which the operator is running - in particular the Kubernetes version.
You can use this if the security context should be set differently for different Kubernetes versions.
In many cases, you will not have anything to configure.
In that case, you can just _do nothing_ in this method:

```java
    @Override
    public void configure(PlatformFeatures platformFeatures) {
        // Nothing to configure
    }
```

Next, the interface defines several methods which create the Pod Security Context and (container) Security Context.
These methods will exist for every Pod and every container created by Strimzi.
For example, the interface defines the following methods for the Kafka pods:
* `PodSecurityContext kafkaPodSecurityContext(PodSecurityProviderContext context)` for the Pod Security Context
* `SecurityContext kafkaContainerSecurityContext(ContainerSecurityProviderContext context)` for the Security Context of the init container used for rack awareness or node port listeners
* `SecurityContext kafkaInitContainerSecurityContext(ContainerSecurityProviderContext context)` for the security context of the main Apache Kafka container

When these methods are called by Strimzi, they will always get an object of type `PodSecurityProviderContext` or `ContainerSecurityProviderContext` as a parameter.
The context contains two types of information:
* The storage configuration that might be needed to set some specific configuration for the stateful operands concerning their storage.
  We do not care about the storage in this example, so we can ignore it.
* The Security Context configured by the user directly in the custom resource.
  In the Pod Security Providers provided directly by Strimzi, the user-provided security context takes always priority over whatever the provider sets.
  But it is up to you whether your custom provider decides to respect the user-configured security context or whether it will ignore it.
  In this example, we will ignore it for simplicity.

For our example with the read-only root filesystem, we do not care about the Pod Security Context because our configuration is part of the container Security Context.
So we set all the Pod methods to simply return `null` which means that no Pod Security Context should be set.
For example:

```java
    @Override
    public PodSecurityContext kafkaPodSecurityContext(PodSecurityProviderContext context) {
        return null;
    }
```

And in the container methods, we always return the Security Context which enables the read-only root filesystem:

```java
    @Override
    public SecurityContext kafkaContainerSecurityContext(ContainerSecurityProviderContext context) {
        return new SecurityContextBuilder()
                .withReadOnlyRootFilesystem()
                .build();
    }

    @Override
    public SecurityContext kafkaInitContainerSecurityContext(ContainerSecurityProviderContext context) {
        return new SecurityContextBuilder()
                .withReadOnlyRootFilesystem()
                .build();
    }
```

You can find the full source code in the GitHub repository linked at the end of the blog post.

#### Extending an existing policy

If you want to do only some small changes to an existing provider, you do not need to implement everything from scratch.
You can just extend the provider and re-implement only the methods you want to change.
Strimzi currently includes two providers: [`BaselinePodSecurityProvider` and `RestrictedPodSecurityProvider`](https://github.com/strimzi/strimzi-kafka-operator/tree/main/api/src/main/java/io/strimzi/plugin/security/profiles/impl)

For our example, we are going to take the [`RestrictedPodSecurityProvider`](https://github.com/strimzi/strimzi-kafka-operator/blob/main/api/src/main/java/io/strimzi/plugin/security/profiles/impl/RestrictedPodSecurityProvider.java).
It configures the security context of the Strimzi operands to match Kubernetes' _restricted_ security profile.
When you try to use the Kafka Connect Build and its [Kaniko](https://github.com/GoogleContainerTools/kaniko) builder with this provider, it will [throw an exception](https://github.com/strimzi/strimzi-kafka-operator/blob/main/api/src/main/java/io/strimzi/plugin/security/profiles/impl/RestrictedPodSecurityProvider.java#L94-L103) because the Kaniko container builder does not work under the _restricted_ profile.
Imagine, you want to use the `RestrictedPodSecurityProvider` to harden the operand Pods.
But you want to use the Kafka Connect Build feature at the same time without any restrictions.

In such case, you can simply extend the `RestrictedPodSecurityProvider` and override the `kafkaConnectBuildContainerSecurityContext` method with your implementation which will just let it run instead of throwing an exception:

```java
package cz.scholz.providers;

import io.fabric8.kubernetes.api.model.SecurityContext;
import io.strimzi.plugin.security.profiles.ContainerSecurityProviderContext;
import io.strimzi.plugin.security.profiles.impl.RestrictedPodSecurityProvider;

public class CustomPodSecurityProvider2 extends RestrictedPodSecurityProvider {
    @Override
    public SecurityContext kafkaConnectBuildContainerSecurityContext(ContainerSecurityProviderContext context) {
        if (context != null
                && context.userSuppliedSecurityContext() != null)    {
            return context.userSuppliedSecurityContext();
        } else {
            return null;
        }
    }
}
```

This way you achieved what you wanted and you did not need to implement all the methods from scratch.

#### Service Loader configuration

When Strimzi uses the Pod Security Providers, it is using the [Java ServiceLoad](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/ServiceLoader.html) to load the implementations.
To allow Strimzi to load your custom provider, you have to create your provider configuration file.
The provider configuration is part of our source code.
It should be placed in the `resources/META-INF/services/` path in a file which is named `io.strimzi.plugin.security.profiles.PodSecurityProvider` (i.e. the name of the interface implementation you provide).
The file should contain the names of the class with your implementation including the package name.
So in our case, it should contain the following classes:

```
cz.scholz.providers.CustomPodSecurityProvider
cz.scholz.providers.CustomPodSecurityProvider2
```

#### Respect your Kubernetes platform

The Pod Security providers allow you to customize the Pod and container security context configuration.
They define how the Pods created by Strimzi will look like.
One important thing to keep in mind is that your Kubernetes platform might have its requirements for how the security context should be configured and in some cases will even automatically inject it into the Pods.
Stateful Pods such as ZooKeeper or Kafka might also require specific configurations to be able to use the persistent volumes and read from them or write to them.
So when writing custom policies, you have to make sure that the security context generated by your custom provider does not conflict with the requirements of your Kubernetes platform.
Because if they are not aligned, the Pods might be rejected by the Kubernetes cluster or might not work properly.

### Deploying the custom policy

Once you have the Java code ready, you have to compile and package it into a JAR file.
With Maven, you would typically do it using the following command:

```
mvn clean package
```

And then you need to add the JAR to a custom container image that extends the Strimzi operator container.
You can do that with the following `Dockerfile`:

```Dockerfile
FROM quay.io/strimzi/operator:0.34.0

USER root:root

COPY ./target/*.jar lib/

USER 1001
```

The Strimzi version in the `FROM` command at the beginning of the `Dockerfile` should correspond to the Strimzi version you use.
You also need to build the container image and push it to a registry:

```
docker build -t <MyContainerRegistry>/<MyUser>/<MyImage>:<MyTag> .
docker push <MyContainerRegistry>/<MyUser>/<MyImage>:<MyTag>
```

For example:

```
docker build -t quay.io/scholzj/operator:custom-providers .
docker push quay.io/scholzj/operator:custom-providers
```

Once the image is pushed there, you have to modify your Strimzi Cluster Operator deployment:

1. Change the `image` field from for example `quay.io/strimzi/operator:0.34.0` to the image you just built
2. Add the JAR with your custom provider to the Java classpath using the `JAVA_CLASSPATH` environment variable.
   For example:
   ```
         - name: JAVA_CLASSPATH
           value: lib/custom-pod-security-providers-1.0-SNAPSHOT.jar
   ```
   _(Note: This option is available only from Strimzi 0.34.0)_
3. Instruct Strimzi to use your custom provider using the `STRIMZI_POD_SECURITY_PROVIDER_CLASS` environment variable.
   For example:
   ```
         - name: STRIMZI_POD_SECURITY_PROVIDER_CLASS
           value: cz.scholz.providers.CustomPodSecurityProvider
   ```

Once you update the Deployment with these changes, it will roll the Cluster Operator pod to activate the new provider.
If you have any operands deployed and the new provider caused changes to their security context, the operator will proceed and roll them as well.
If not, just deploy a Kafka cluster using one of our provided examples.
Once it is deployed, you can check its Security Context and you should see that the Pods and containers have the security context defined by your provider.
In our case, all containers will have the read-only root filesystem option enabled:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-cluster-kafka-0
  # ...
spec:
  # ...
  containers:
    name: kafka
    securityContext:
      readOnlyRootFilesystem: true
    # ...
```

### Conclusion and examples

Hopefully, this blog post helps you to write your own Pod Security Providers and extend your Strimzi installation.
To help you get started, all the code mentioned in this post is also available on GitHub.
You can find it in [this repository](https://github.com/scholzj/custom-pod-security-providers).
The example repository contains the Java classes as well as the provider configuration file and the `Dockerfile` which you need for custom providers.
