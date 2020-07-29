---
layout: post
title:  "Using Open Policy Agent with Strimzi and Apache Kafka"
date: 2020-07-30
author: jakub_scholz
---

One of the new features in Strimzi 0.19.0 is support for Kafka authorization using [Open Policy Agent](https://www.openpolicyagent.org/).
In this blog post, we will look at this feature with more detail.
It will explain the (dis)advantages, compare it with other supported authorization methods and look at some interesting ways how to use it.

<!--more-->

Until Strimzi 0.19.0, we supported two types of authorization:

* The `simple` authorization which is using the `SimpleAclAuthorizer` which is part of the Apache Kafka project
* The `keycloak` authorization which is using [Keycloak Authorization Services](https://www.keycloak.org/docs/latest/authorization_services/index.html)

All three authorization types supported in Strimzi 0.19.0 are based on the same authorization interface provided by Kafka.
When a Kafka client tries to call some Kafka API, Kafka will pass the following information to the authorization plugin:
* Operation (`Read`, `Write`, `Create`, `Delete`, `Alter`, `Describe`, `ClusterAction`, `DescribeConfigs`, `AlterConfigs`, `IdempotentWrite`, and `All`)
* Resource type (`Topic`, `Group`, `Cluster`, `TransactionalId`, `DelegationToken`)
* Resource name
* User identity
* Address from which the user connects

Every authorizer implementation receives the same information and the only difference is how it evaluates it and decided whether to allow or deny the operation.

## Simple authorization

The `simple` authorization is based on the default authorizer plugin shipped with Apache Kafka.
It was originally implemented in Scala class `SimpleAclAuthorizer` - that is where the `simple` keyword is coming from.
In newer Kafka versions it has been replaced with new Java class `AclAuthorizer` which is backward compatible and Strimzi will migrate to it in one of the future releases.

With `simple` authorization, you have to specify the ACL rules for each user.
The ACL rules have to cover all operations which the user is allowed to do.
You can use prefix or the `*` wildcard to cover multiple resource names with one ACL rule, but that is it.
It also doesn't support any groups, so even if you have multiple users with the same rights, you need to configure the ACL rules individually for each of them.
So you often end up with lot of different rules for each user.

The main advantage of the `simple` authorization is that it is ... well ... _simple_.
The ACL rules for the `simple` authorization are stored inside ZooKeeper.
When the rules change, the Kafka brokers will be notified about the change and load the new ACLs.
You do not need to deploy and operate any other application.
Everything is built into the Strimzi, Kafka and ZooKeeper.
Another advantage is that it can be easily combined with all of our authentication mechanisms.
It is also supported in the User Operator, so you can configure the ACL rules directly in the `KafkaUser` custom resources.
So you can easily configure everything in YAML, store it in your Git repository and use GitOps to manage the resources.

## Keycloak Authorization Services

[Keycloak](https://www.keycloak.org/) is an open source identity and access management server.
Strimzi supports authentication of Kafka clients using OAuth 2.0 access tokens.
And Keycloak is one of the servers you can use for it (see our older blog post _[Kafka authentication using OAuth 2.0](https://strimzi.io/blog/2019/10/25/kafka-authentication-using-oauth-2.0/)_).
But you can also use it for authorization thanks to our own `KeycloakRBACAuthorizer`.

The `keycloak` authorization is based on the [Keycloak Authorization Services](https://www.keycloak.org/docs/latest/authorization_services/index.html).
It can be used only in combination with OAuth 2.0 authentication.
Security policies and permissions are defined in Keycloak are used to grant access to resources on Kafka brokers. 
Users and clients are matched against policies that permit access to perform specific actions on Kafka brokers.
You can also use the _federation_ feature of Keycloak to map the policies for example against LDAP groups.
The `KeycloakRBACAuthorizer` will fetch the list of granted permissions from Keycloak and enforce the authorization rules locally to make sure it doesn't affect the client performance.

The main advantage of Keycloak is that you can have everything managed centrally.
Not just for Strimzi and Apache Kafka, but for all your applications which support OAuth.
It can also handle both authentication and authorization.
So you do not need to have different servers for authentication and authorization and all data are stored in one place.

On the other hand, you will still need to run and manage Keycloak.
So unless you already use it or at least plan to use some central authentication / authorization server anyway, this will be additional effort you would need to deal with.

## Open Policy Agent

[Open Policy Agent](https://www.openpolicyagent.org/) (OPA) is an open source policy engine.
It can be used to enforce policies across your whole architecture stack.
The policies are declarative and to write them it is using its own language called _Rego_.
OPA can be used for policy based control of many different applications.
It can be used with Kubernetes, APIs, SSH, CI/CD pipelines and many more.

OPA decouples the policy decision making from enforcing the decision.
When used with Kafka, the authorizer running inside Kafka will call OPA server to evaluate the policy based on the input from the authorizer.
The input will be the same set of information as with any other Kafka authorizer
It is described in the introduction to this blog post.
OPA will evaluate the policy and respond to the authorizer request with a decision.
And the authorizer will either allow or deny the operation.
The decisions are of course cached by the authorizer to make sure the performance of the Kafka clients is not affected.

We didn't developed our own OPA Authorizer for Kafka.
Instead we are using the existing [OPA Plugin from Bisnode](https://github.com/Bisnode/opa-kafka-plugin).

### Configuring OPA authorizer

Before we configure our Kafka cluster to use OPA, we first need to deploy the OPA server.
If you don't use OPA yet, you can follow [this guide](https://www.openpolicyagent.org/docs/latest/deployments/#kubernetes) from the OPA documentation.

Once you have OPA running, you can configure the OPA authorizer in your `Kafka` custom resource.
The basic configuration should looks like this:

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: Kafka
metadata:
  name: my-cluster
spec:
  kafka:
    # ...
    authorization:
      type: opa
      url: http://opa.anmespace.svc:8181/v1/data/kafka/authz/allow
    # ...
```

For using OPA authorizer, you have to set the `type` field to `opa`.
You also always need to configure the `url`.
The URL will not just tell it how to connect to the OPA server.
But it will also specify which policy should be used.
In our case, we will connect to the OPA server at `http://opa.anmespace.svc:8181`.
And the `/kafka/authz/allow` part defines that we will use the `allow` decision from the policy from package `kafka.authz`.

There are some additional options which are optional.
You can configure the decision cache - its capacity and expiration.
You can also configure super users which will be allowed everything without asking OPA for a decision.
The full OPA authorizer configuration might look for example like this:

```yaml
authorization:
  type: opa
  url: http://opa:8181/v1/data/kafka/authz/allow
  allowOnError: false
  initialCacheCapacity: 1000
  maximumCacheSize: 10000
  expireAfterMs: 60000
  superUsers:
    - CN=fred
    - sam
    - CN=edward
```

### Basic policies

The OPA documentation already has a very basic demo for Kafka authorization: https://www.openpolicyagent.org/docs/latest/kafka-authorization/




### Combining different data sources





## Conclusion

The main advantage of OPA authorization compared to the `simple` or Keycloak authorizers is its flexibility.
The examples from the previous section might not be exactly production grade.
But I think they very well demonstrate how easily you can use OPA and Rego to combine data from different sources and use them for the authorization decisions.

With the `simple` authorizer, you have to follow the ACL rules defined for each user and stored in ZooKeeper.
With Keycloak, you can use the permissions defined in Keycloak.
But with OPA, you can use any external data you want.
OPA calls this _context-aware authorization and decisions_.
You can [easily integrate](https://www.openpolicyagent.org/docs/latest/external-data/) OPA with different external data sources and use these data for the decision making to do exactly what you want.

The main disadvantage is that unless you are already using OPA for other applications, you will need to run yet another application.

## Next time

In this blog post we focused on Open Policy Agent as authorization server for Apache Kafka clusters.
But OPA can do more.
Next time we will look at other ways how OPA can help Strimzi users.