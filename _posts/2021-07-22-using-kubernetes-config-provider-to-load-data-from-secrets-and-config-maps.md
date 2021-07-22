---
layout: post
title:  "Using Kubernetes Configuration Provider to load data from Secrets and Config Maps"
date: 2021-07-22
author: jakub_scholz
---

When running Apache Kafka on Kubernetes, you will sooner or later probably need to use Config Maps or Secrets.
Either to store something in them, or load them into your Kafka configuration.
That is true regardless of whether you use Strimzi to manage your Apache Kafka cluster or something else.
Kubernetes has its own way of using Secrets and Config Maps from Pods.
But they might not be always sufficient.
That is why in Strimzi, we created Kubernetes Configuration Provider for Apache Kafka which we will introduce in this blog post.

<!--more-->

Usually, when you need to use data from a Config Map or Secret in your Pod, you will either mount it as volume or map it to an environment variable.
Both methods are configured in the `spec` section or the Pod resource or in the `spec.template.spec` section when using higher level resources such as Deployments or StatefulSets.

When mounted as a volume, the contents of the Secret or Config Map will appear as files inside your Pod and its containers.
Your application can just read and work with them as with any other files.
The path where the files appear is configurable in the Pod specification, so you can mount them exactly where your application would expect them.
You can also mount only selected files / fields instead of mounting the whole Secret or Config Map.
When the contents of the Secret or Config Map changes, the files inside the Pod will be automatically updated (this does not happen immediately but in periodical intervals).

When using environment variables, you can specify the name of the variable and the source of its value.
One environment variable will also map to a single field from Secret or Config Map.
The environment variable value does not change once the container is running even if the value in the Secret or Config Map changes.
Inside your application, you can use these environment variables in the same way as any other.

You can read more about these mechanisms in the Kubernetes documentation:
* [Using Secrets](https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets)
* [Using Config Maps as volumes](https://kubernetes.io/docs/concepts/configuration/configmap/#using-configmaps)
* [Using Config Maps as environment variables](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/#define-container-environment-variables-using-configmap-data)

In many cases, these two mechanisms are fully sufficient.
However, they have also some limitations:

* They can be used only by applications running inside the Kubernetes cluster as Pods.
  Applications running outside the Kubernetes cluster cannot use Secrets or Config Maps in this way
* The Secrets and Config Maps you can load have to be in the same namespace as your application.
  If they are in different namespace, you would need to copy them into your application namespace.
* Any changes - such as adding an additional volume or environment variable - require a restart of the whole Pod.

If these limitations are a problem for your Kafka application, you should keep reading to find out how the Kubernetes Configuration Provider can help you.

## Apache Kafka Configuration Providers

Apache Kafka and all its components are configured using properties.
In some cases - such as with Kafka brokers, Connect or Mirror Maker - you specify them inside [properties files](https://en.wikipedia.org/wiki/.properties).
In the Java-based clients - Consumer, Producer, Streams and Admin APIs - you usually configure them using a `Properties` class created inside your application.

In all of these configurations, Apache Kafka lets you use _configuration providers_.
Configuration providers are classes implementing the `ConfigProvider` interface.
Configuration providers can be used in the configuration instead of the configuration value and they will be responsible for providing the actual value.
The typical use cases is that they load the value from some external source.

By default, Kafka has two configuration providers.
The `FileConfigProvider` loads configuration values from properties in a file.
The `DirectoryConfigProvider` loads configuration values from separate files within a directory structure.
Both are very nicely explained in the [Strimzi documentation](https://strimzi.io/docs/operators/latest/full/using.html#type-ExternalConfiguration-reference).

However, you are not limited to these two configuration providers.
You can add your own - you can either write a new configuration provider yourself or you can just download an existing one.
All you need to do is to place a JAR with a class implementing the `ConfigProvider` interface in the class-path.
For example by adding it to the `libs` directory in Kafka or adding it as a Maven dependency in your Java build.

## Kubernetes Configuration Provider

In Strimzi, we saw several use-cases where mounting Secrets or Config Maps as volumes or mapping them as environment variables was not sufficient or not optimal.
That is why we created our own configuration provider which allows you to reference Kubernetes Secrets and Config Maps directly from your Kafka configuration.
To load data from Secrets or Config Maps with the configuration provider, you do not need to specify anything in your Kubernetes Pods, Deployments or StatefulSets.
Instead, a Kubernetes client running inside your application obtains the values from the Secrets or Config Maps directly from the Kubernetes API server.
That means:
* As long as you have the corresponding RBAC rights, you can load the data from Secrets or Config Maps in any namespace.
  The Secret or Config Map does not have to be in the same namespace as your application anymore.
* Your application can run outside the Kubernetes cluster and connect to the Kubernetes API server remotely.
* To read the value from a different Secret or Config Map, you do not need to restart the whole Pod.
  You can just update the configuration _on the fly_ without any restarts.

To use it, you have to make sure that the application will be able to access the Kubernetes API Server.
If you are running it in a Pod inside Kubernetes cluster, you should configure the Service Account and create the required roles and role bindings so that it can access the desired Secret or Config Map.
Next, you can initialize the Configuration providers in the Kafka configuration:

```properties
config.providers=secrets,configmaps
config.providers.secrets.class=io.strimzi.kafka.KubernetesSecretConfigProvider
config.providers.configmaps.class=io.strimzi.kafka.KubernetesConfigMapConfigProvider
```

Then you can just use it to get the right values.
The value has to always references the name of the config provider instance - in this case `configmaps` for reading values from Config Map.
It also needs to specify the name of the Config Map and the namespace in which it exists.
In the example below, the namespace is `my-namespace` and the Config Map name is `my-config-map`.
It also need to specify the name of the field from which the configuration value should be extracted.
In this example the field name is `field1`.

```properties
option=${configmaps:my-namespace/my-config-map:field1}
```

To better demonstrate the value of the Kubernetes Configuration Provider and how to use it, lets have a look at two examples.
The first one will use it for configuring Kafka Connect connectors.
The second will use it to get credentials in Kafka consumer / producer.

## Using secrets in Kafka Connect connectors

Strimzi already has a way of using Secrets and Config Maps in Kafka Connect and its connectors.
You can use the `externalConfiguration` section in the `KafkaConnect` custom resource to mount them as volumes or environment variables.
Then you can use the `FileConfigProvider` or `DirectoryConfigProvider` to load these in the connector configuration.
You can read more about it in our [documentation](https://strimzi.io/docs/operators/latest/full/using.html#proc-loading-config-with-provider-str).

But when you use a single Kafka Connect cluster for many different connectors, any change to the `externalConfigurations` - for example to mount new Secret because of new connector - would require restart of all nodes of the Connect cluster.
So in order to add a new connector, you will cause a disruption to all the other connectors which are running.
The connectors should normally be able to handle this without any problems.
But why try your luck when you can avoid this by using the Kubernetes Configuration Provider.

The configuration provider has to be first initialized in the `KafkaConnect` custom resource:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnect
metadata:
  name: my-connect
  annotations:
    strimzi.io/use-connector-resources: "true"
spec:
  # ...
  config:
    # ...
    config.providers: secrets,configmaps
    config.providers.secrets.class: io.strimzi.kafka.KubernetesSecretConfigProvider
    config.providers.configmaps.class: io.strimzi.kafka.KubernetesConfigMapConfigProvider
  # ...
```

When you deploy the Kafka Connect cluster, Strimzi will automatically create a Service Account for it.
It will be named `<KafkaConnect-name>-connect`.
So for the example above, the name will be `my-connect-connect`.
This is the Service Account which will be used by the configuration providers.
So before we create the connector, we will need to create the RBAC resources to give it the rights to read the Secrets or Config Maps we want.

First, we need to create a Role:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: connector-configuration-role
  namespace: database
rules:
- apiGroups: [""]
  resources: ["secrets"]
  resourceNames: ["db-credentials"]
  verbs: ["get"]
```

This Role has to be created in the namespace where the Secret or Config Map we want to use exists.
In the example above, this Role will give access only to a single Secret named `db-credentials` in namespace `database`.
And the only operation it allows is `get` to read the Secret.
This way, the configuration provider with this Role will not be able to modify the secret or read any other secrets.
You can of course customize the Role.
You can specify multiple Secrets or add Config Maps as well, it all depends on your requirements.

Next, we need to create a Role Binding to assign this Role to the Kafka Connect Pods:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: connector-configuration-role-binding
  namespace: database
subjects:
- kind: ServiceAccount
  name: my-connect-connect
  namespace: myproject
roleRef:
  kind: Role
  name: connector-configuration-role
  apiGroup: rbac.authorization.k8s.io
```

The Role Binding should be once again created in the namespace where the Secret or Config Maps which we want to read exists.
In the `subjects` section, we need to specify the name of the Service Account used by the Kafka Connect Pods and the namespace where the Kafka Connect cluster is deployed.
If you want to consume Secrets or Config Maps from multiple namespace, you need to create multiple Roles and Role Bindings - each in the corresponding namespace.

Once we have the RBAC resources created, we can create the connector:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaConnector
metadata:
  name: my-connector
  labels:
    strimzi.io/cluster: my-connect
spec:
  # ...
  config:
    database.user: ${secrets:database/db-credentials:username}
    database.password: ${secrets:database/db-credentials:password}
    # ...
```

_Note: The RBAC resources are applied on the Pod level. So the Secret will be accessible to all connectors running in the same Kafka Connect cluster and not just to this particular connector._

We use the `secrets` provider to load the fields from the `db-credentials` Secret.
We will load the `username` field for the database user and `password` field for the database password.

And that is it.
Adding a new connector like this to the Kafka Connect deployment would not cause any Pod restarts disrupting all the other connectors sharing the same Connect cluster.

## Loading credentials from Secrets in Kafka clients

Another example, where the Kubernetes Configuration Provider can be helpful is in Kafka clients.
When you deploy Kafka cluster using Strimzi, it will generate Secrets with TLS certificates used for encryption in the same namespace.
Also, when you use the User Operator to manage users, it will generate the Secrets with the credentials typically in the Kafka cluster namespace.

But in most cases, the applications using Kafka have their own namespace.
Therefore they cannot easily mount the Secrets as volumes or environment variables.
So you need to copy the Secrets to a different namespace and make sure they stay up-to-date.
When your application runs outside the Kubernetes cluster, copying the Secrets is not an option.
Instead, you have to export the files from the secret and keep them carefully in-sync when the original secret changes.
None of this is needed with Kubernetes Config Provider.

First, we need to make sure the configuration provider can connect to the Kubernetes API and get the Secrets or Config Maps.
If your application runs inside the Kubernetes cluster, the configuration provider should automatically configure itself from the Service Account.
If your application runs outside Kubernetes, it will usually use a user account instead of a service account.
The configuration provider will by default use the `Kubeconfig` file from `~/.kube` directory or from other path specified in the `KUBECONFIG` environment variable.
The Kubernetes Configuration Provider is based on the Fabric8 Kubernetes Client.
Full list of configuration options can be found in the [GitHub repository](https://github.com/fabric8io/kubernetes-client#configuring-the-client).

Regardless whether you use service account or user account, you have to give it the RBAC rights to read the secret.
In this example, the client will connect using TLS Client Authentication.
So the client will need to read the Secret with the cluster CA public key and the user Secret created by the User Operator.
Therefore the Role needs to include both of them:
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: kafka-client-role
  namespace: kafka
rules:
- apiGroups: [""]
  resources: ["secrets"]
  resourceNames: ["my-kafka-cluster-ca-cert", "my-user"]
  verbs: ["get"]
```

The example above expects that the name of the Kafka cluster is `my-kafka` and it is in namespace called `kafka`.
It also expects that in the same namespace, we created a `KafkaUser` resource named `my-user` with `type: tls` authentication.
We also need to create the matching Role Binding:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kafka-client-role-binding
  namespace: kafka
subjects:
- kind: ServiceAccount
  name: my-client
  namespace: myproject
roleRef:
  kind: Role
  name: kafka-client-role
  apiGroup: rbac.authorization.k8s.io
```

The Role Binding should either reference the Service Account:

```yaml
- kind: ServiceAccount
  name: my-client
  namespace: myproject
```

Or the user account:

```yaml
- kind: User
  name: my-client
  apiGroup: rbac.authorization.k8s.io
```

Once we are finished with the preparation of the accounts and the RBAC resources, we can configure our Kafka client.
We have to add the Kubernetes Configuration Provider to it as a dependency:

```xml
<dependency>
    <groupId>io.strimzi</groupId>
    <artifactId>kafka-kubernetes-config-provider</artifactId>
    <version>0.1.0</version>
</dependency>
```

Then we have to initialize it and use it to load the PEM certificates from the Secrets.
The client configuration should look like this:

```java
Map<String, Object> props = new HashMap();

props.put("config.providers", "secrets");
props.put("config.providers.secrets.class", "io.strimzi.kafka.KubernetesSecretConfigProvider");

props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "my-bootstrap.mydomain.tls:9092");
props.put(CommonClientConfigs.SECURITY_PROTOCOL_CONFIG, "SSL");
props.put(SslConfigs.SSL_KEYSTORE_TYPE_CONFIG, "PEM");
props.put(SslConfigs.SSL_KEYSTORE_CERTIFICATE_CHAIN_CONFIG, "${secrets:kafka/my-user:user.crt}");
props.put(SslConfigs.SSL_KEYSTORE_KEY_CONFIG, "${secrets:kafka/my-user:user.key}");
props.put(SslConfigs.SSL_TRUSTSTORE_TYPE_CONFIG, "PEM");
props.put(SslConfigs.SSL_TRUSTSTORE_CERTIFICATES_CONFIG, "${secrets:kafka/my-cluster-cluster-ca-cert:ca.crt}");
```

The way the Secrets are referenced in the configuration is exactly the same as in the pervious example.
It uses the format `<namespace>/<resourceName>:<key>` - for example `${secrets:kafka/my-cluster-cluster-ca-cert:ca.crt}`.
You can of course also add any additional options your Kafka client needs.

With a setup like this, you do not need to copy any Secrets anymore or extract files from them.
You can just load them directly from the Kubernetes cluster.

## Conclusion

If mounting Secrets and Config Maps as volumes or mapping them to environment variables works well for you, you should probably stick with it.
However as shown in the examples, there are many situations where the Kubernetes Configuration Provider allows you to do things which would otherwise not be possible.

Starting with Strimzi 0.24.0, the Kubernetes Configuration Provider is automatically included in all Strimzi components.
It is also available in Maven repositories, so that you can easily add it to your Java builds and use it from your clients.
The examples in this post showed it used with Strimzi operators, but you can use it with any Kafka deployment.
There is no dependency on the rest of the Strimzi project.

As with everything we do in Strimzi, it is open source and licensed under the Apache License 2.0.
The source code can be found in our [GitHub organization](https://github.com/strimzi/kafka-kubernetes-config-provider).
You can also raise issues there and contribute to the project.
