---
layout: post
title:  "Beyond mTLS: Configurable Security for Internal Apache Kafka Cluster Communication"
date: 2026-09-22
author: jakub_scholz
---

For a long time, one thing has been common to every Strimzi-based Apache Kafka cluster.
It uses TLS encryption and mTLS authentication for all internal cluster communication.
Data replication between brokers, KRaft controller communication, Strimzi operators talking with Kafka … all of this always uses TLS encryption and mTLS authentication.
But with Strimzi 1.3.0, this is going to change!

<!--more-->

> WARNING: This blog post previews an unreleased feature that will be part of the upcoming Strimzi 1.3.0 release.

When we created Strimzi, we wanted it to be secure out of the box.
So TLS encryption and mTLS authentication were baked into it from the beginning.
Being secure sounds like a good idea and it is what is desired in most cases.
But there are always some situations where hardcoded TLS encryption is not the optimal choice.

TLS encryption does not come for free.
It can cost a lot of CPU and impact the performance.
It also prevents you from using zero-copy when reading data from disk and sending it to consumers.
And in air-gapped environments, one can argue that performance might sometimes be more important than encryption.
And even when TLS encryption is desired, it might be done at a different level.
For example, when encryption is already provided by Istio or some other service mesh, you do not need it to happen again at the Strimzi level.
These are some of the reasons why Strimzi users have been asking for a long time to be able to disable the TLS encryption.

Disabling encryption sounds simple.
Unfortunately, it is a bit more complicated than that.
Remember, Strimzi does not only rely on TLS encryption, but also on mTLS authentication.
And it cannot use mTLS authentication when TLS encryption is disabled.
And without authentication, we would also lose authorization and the Kafka cluster would be completely insecure.
And that would usually not be acceptable.
Even in air-gapped environments, you want the services using your Kafka cluster to be authenticated and properly authorized.
You do not want anyone to be able to connect to the Kafka cluster and consume or produce messages without any restrictions.
And since Istio does not really understand the Kafka protocol, it cannot give you any real security either.
It can only encrypt the communication.

So the task was not just to allow disabling TLS encryption.
But also to introduce a new authentication mechanism that is independent of the TLS encryption.
And that was one of the reasons why it took us so long to ship this improvement.

### Configurable Internal Cluster Security

The solution was introduced in [Proposal 150 — _Configurable Security for Internal Kafka Cluster Communication_](https://github.com/strimzi/proposals/blob/main/150-configurable-security-of-internal-communication.md).
The proposal introduces two new configuration options:

* Encryption configuration
* Authentication configuration

The encryption configuration allows you to enable or disable TLS.
And the authentication configuration lets you choose between mTLS authentication (supported only when TLS encryption is enabled as well), no authentication, and Service Account-based authentication.

> IMPORTANT: This configuration affects only the internal communication within the Kafka cluster.
> It has no impact on the listeners you configured in `.spec.kafka.listeners`.

Service Account authentication is the new authentication type we are introducing, and it does not depend on the TLS encryption.
Already before this proposal, every Strimzi component had its own Service Account.
And now we use these Service Accounts for authentication at the Apache Kafka level as well.
The Service Account identity is based on the Service Account name and its namespace.
And the Service Accounts are represented by JWT tokens that can be validated using OIDC and JSON Web Key Sets (JWKS).
To isolate the Service Accounts belonging to different applications, each Kafka cluster is using its own unique audience in the JWT tokens.

We use two different ways to get the Service Account JWT tokens.
In the operands — Kafka nodes, Topic and User Operators, Kafka Exporter, and Cruise Control — we use [projected `serviceAccountToken` volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/#serviceaccounttoken).
The projected volumes mount the Service Account token into the container file system and automatically refresh it before it expires.
The tokens are short-lived and are typically valid for one hour.
But you can configure how long they are valid.

The Cluster Operator cannot use the projected volumes.
It needs to use a different Service Account for each Kafka cluster in order to make sure the different Kafka clusters are properly isolated.
And it cannot add a new projected volume to itself every time a new cluster with Service Account authentication is created.
So instead, it uses the [`TokenRequest` API](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.35/#tokenrequest-v1-authentication-k8s-io) to get the tokens directly from the Kubernetes API.

At the Kafka level, we use the [Strimzi OAuth library](https://github.com/strimzi/strimzi-kafka-oauth).
On the client side, it loads the token from the file mounted through the projected volume and uses it for authentication with the Kafka server.
And on the server side, we use the Kubernetes JWKS keys to validate the tokens.
In the Cluster Operator, we use our own callback handler to be able to get the token from the Kubernetes API itself.

The Service Account tokens are also used for authentication in the Kafka Agent that is running inside the Kafka brokers.
The Kafka Agent provides some additional information about the state of the Kafka cluster through an HTTP API.
It is used by the Cluster Operator.

So, how do you configure it?

### Configuring the Internal Cluster Security

In Strimzi 1.3.0, the cluster security configuration will be available as an early access feature.
We hope you will give it a try and let us know whether it works for you or not.
While in early access, we use an annotation to configure it.
And once we — with your help — manage to validate that the model works, we will move the configuration into the `.spec` section of the `Kafka` CR.

The annotation used for the configuration is `strimzi.io/internal-cluster-security` and it contains a JSON structure with the authentication and encryption configurations.
The annotation is placed on the `Kafka` CR.
The following example disables both the TLS encryption and the mTLS authentication:

```yaml
apiVersion: kafka.strimzi.io/v1
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/internal-cluster-security: |
      {
        "encryption": {
          "type": "none"
        },
        "authentication": {
          "type": "none"
        }
      }
spec:
  # ...
```

For the authentication, you can choose one of three types: `none`, `mtls` and `service-account`.
For the encryption you can use the types `none` and `tls`.
The mTLS authentication can be used only with the TLS encryption.
But otherwise you can combine the options in any way you want.

The following example shows Service Account-based authentication with TLS encryption:

```yaml
apiVersion: kafka.strimzi.io/v1
kind: Kafka
metadata:
  name: my-cluster
  annotations:
    strimzi.io/internal-cluster-security: |
      {
        "encryption": {
          "type": "tls"
        },
        "authentication": {
          "type": "service-account"
        }
      }
spec:
  # ...
```

> NOTE: For the full list of configuration options and additional examples, please follow the Strimzi 1.3.0 documentation once it is released.

Without the annotation, TLS encryption and mTLS authentication will be used as before.
So if you are happy with how Strimzi worked until now, you can just ignore the annotation.
But when you are deploying a new Kafka cluster and want to use the new options, just add the annotation.

But what about the existing Kafka clusters?

### Migrating Existing Clusters

You can of course change the cluster security configuration for existing clusters as well.
However, you cannot do it _on the fly_ without any interruptions.
You have to:

* Pause the reconciliation of the Kafka cluster
* Shut down the Kafka cluster by stopping all its pods
* Update the security configuration
* Start the Kafka cluster again by unpausing the reconciliation

> NOTE: For the detailed steps, please follow the full migration documentation once Strimzi 1.3.0 is released.

Stopping the whole Kafka cluster makes the migration significantly easier.
For example, we do not need a complicated multi-step process that would add and remove internal Kafka listeners to change the authentication or encryption.
So it saves us a lot of implementation and maintenance effort.
And since this is not the kind of configuration that you would be changing every day, we do not expect this to be a major issue and do not have any plans to support the migration _on the fly_.

### Early Access and What's Next

As mentioned above, this feature will be released in Strimzi 1.3.0 as _early access_.
Please give it a try and share your feedback with us.
With your help, we should be able to validate this feature in one or two releases and mark it as generally available.

There are also still some limitations to be aware of.
For example:

* In Strimzi 1.3.0, even if you disable TLS encryption, Strimzi will still maintain its Certificate Authorities.
* While disabling the TLS encryption makes it easier to run Strimzi within a service mesh such as Istio, it does not provide full integration.

These and other improvements might be added in future Strimzi releases.

If you find any issues with the implementation, or have suggestions related to the internal cluster security configuration, you can share your feedback with us on [Slack](https://slack.cncf.io/), or by opening [a discussion](https://github.com/orgs/strimzi/discussions) or [an issue](https://github.com/strimzi/strimzi-kafka-operator/issues) on GitHub.
