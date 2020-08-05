---
layout: post
title:  "Using Open Policy Agent with Strimzi and Apache Kafka"
date: 2020-08-05
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

![Open Policy Agent](/assets/images/posts/2020-08-05-using-open-policy-agent-with-strimzi-and-apache-kafka-png)

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
    - CN=henri
    - anwar
    - CN=wesley
```

### Examples policies

Explaining the basics of the Rego language and Open Policy Agent policies goes well beyond the scope of this blog post.
Both is nicely explained in the [OPA documentation](https://www.openpolicyagent.org/docs/latest/).
But I will show you some examples how you can use OPA with Apache Kafka to demonstrate its strength and versatility.
The complete policy files from these examples including the instructions how to use them can be found on my [GitHub](https://github.com/scholzj/demo-opa-kafka-authorization).

Additionally, the OPA documentation has a simple demo for [Kafka authorization](https://www.openpolicyagent.org/docs/latest/kafka-authorization/) as well.

### Group based authorization

One of the features users are asking for from time to time is group based authorization.
This is currently not supported in Strimzi using the `simple` authorization. 
But this example shows how it can be implemented using Open Policy Agent.

We will use 3 different group: consumers, producers and admins.
For each of these groups, we will need to define the set of operations they will be allowed to use.
We will also add some helper rules to help us evaluate whether the operation we are authorizing belongs into one of these groups:

```rego
consumer_operations = {
                        "Topic": ["Read", "Describe"], 
                        "Group": ["Read", "Describe"]
                    }

producer_operations = {
                        "Topic": ["Write", "Describe"]
                    }

admin_operations = {
                    "Topic": ["Read", "Write", "Create", "Delete", "Alter", "Describe", "ClusterAction", "DescribeConfigs", "AlterConfigs"], 
                    "Group": ["Read", "Delete", "Describe"],
                    "Cluster": ["Create", "Alter", "Describe", "ClusterAction", "DescribeConfigs", "AlterConfigs"]
                    }

is_consumer_operation {
    consumer_operations[input.resource.resourceType.name][_] == input.operation.name
}

is_producer_operation {
    producer_operations[input.resource.resourceType.name][_] == input.operation.name
}

is_admin_operation {
    admin_operations[input.resource.resourceType.name][_] == input.operation.name
}
```

We also need to define the actual groups and their members:

```rego
consumer_group = ["tom", "tyrone", "matt", "pepe", "douglas"]
producer_group = ["jack", "conor", "keinan", "john"]
admin_group = ["dean", "christian"]

is_consumer_group {
    consumer_group[_] == principal.name
}

is_producer_group {
    producer_group[_] == principal.name
}

is_admin_group {
    admin_group[_] == principal.name
}
```

The group definition is again accompanied by some helper rules.
Each group is defined as an array of it members.
So we have the groups and their members hardcoded into the policy and to change them, you will need to change the policy.

Next, we will create some helper rules for evaluating whether the request we are authorizing belongs to a user who is member of one of the groups and is for access rights which belong to such group:

```rego
allow_consumer_group {
    is_consumer_operation
    is_consumer_group
}

allow_producer_group {
    is_producer_operation
    is_producer_group
}

allow_admin_group {
    is_admin_operation
    is_admin_group
}
```

When the operation we are authorizing belongs to the consumer operations and the user belongs to the consumer group, the `allow_consumer_group` will evaluate to `true`.
If the operation is not one of the operations allowed to consumers and/or the user doesn't belong to the consumer group, it will evaluate to `false`.
The other two rules - `allow_producer_group` and `allow_admin_group` - work in the same way.

Last, we need to add the `allow` rule which is what the Kafka Authorizer will actually call:

```rego
allow {
    not deny
}

deny {
    not allow_consumer_group
    not allow_producer_group
    not allow_admin_group
}
```

In this example, we will allow (authororize) all operations which are not _denied_.
So the `allow` rule just refers to the `deny` rule.
And the `deny` rule will deny the authorization when none of the helper rules evaluated to `true`.
So when the operation is not a consumer trying to consume messages, or a producer trying to produce messages and an admin trying to use one of the administration operation, the user will be denied.

The full policy including some additional helper functions can be found on my [GitHub](https://github.com/scholzj/demo-opa-kafka-authorization/blob/master/basic-example-policy.rego).

### Combining different data sources

The policy described in the basic example works.
But it is very simple.
It has just 3 groups which are hardcoded in the policy including their members.
And it doesn't distinguish between different topics.
Each consumer can consume from all topics and each producer can produce into any topic.
Lets have a look at how we can improve the policy by using some external data.
Because Strimzi is using custom resources for managing users and topics, lets try to use them for the authorization.
But you can similarly improve the policy also with data from other sources.

One of the components provided as part of the Open Policy Agent project is a [kube-mgmt](https://github.com/open-policy-agent/kube-mgmt) tool for running OPA on Kubernetes.
It can be used to discover and load policies from Kubernetes ConfigMaps.
But also to replicate Kubernetes resources and make them available in OPA.

To enable it, we will add kube-mgmt as a sidecar container to our Open Policy Agent deployment:

```yaml
        - name: kube-mgmt
          image: openpolicyagent/kube-mgmt:0.11
          args:
            - "--replicate=kafka.strimzi.io/v1beta1/kafkatopics"
            - "--replicate=kafka.strimzi.io/v1beta1/kafkausers"
```

And configure it to replicate the `KafkaUser` and `KafkaTopic` custom resources.
Inside our policy, we can just import the replicated data and we will be able to use them in our policies:

```rego
import data.kubernetes.kafkatopics
import data.kubernetes.kafkausers
```

We will still keep the operations definitions and their helper methods as in the previous example since they did not changed:

```rego
consumer_operations = {
                        "Topic": ["Read", "Describe"], 
                        "Group": ["Read", "Describe"]
                    }

producer_operations = {
                        "Topic": ["Write", "Describe"]
                    }

admin_operations = {
                    "Topic": ["Read", "Write", "Create", "Delete", "Alter", "Describe", "ClusterAction", "DescribeConfigs", "AlterConfigs"], 
                    "Group": ["Read", "Write", "Create", "Delete", "Alter", "Describe", "ClusterAction", "DescribeConfigs", "AlterConfigs"],
                    "Cluster": ["Read", "Write", "Create", "Delete", "Alter", "Describe", "ClusterAction", "DescribeConfigs", "AlterConfigs", "IdempotentWrite"]
                    }

is_consumer_operation {
    consumer_operations[input.resource.resourceType.name][_] == input.operation.name
}

is_producer_operation {
    producer_operations[input.resource.resourceType.name][_] == input.operation.name
}

is_admin_operation {
    admin_operations[input.resource.resourceType.name][_] == input.operation.name
}
```

But we will not hardcode the groups in the policy anymore.
Instead, we will use the `KafkaUser` and `KafkaTopic` resources to define them.
We will use the annotation `groups` on `KafkaUser` custom resource to define into which groups does this user belong.
In the example bellow, you can see an user `payment-processing` who belongs into groups `invoicing` and `orders`

```yaml
apiVersion: kafka.strimzi.io/v1beta1
kind: KafkaUser
metadata:
  name: payment-processing
  annotations:
    groups: '["invoicing", "orders"]'
  labels:
    strimzi.io/cluster: my-cluster
spec:
  authentication:
    type: tls
```

Similarly, we can use the `KafkaTopic` to define who can produce to it and consume from it.
We will use the `producer-groups` and `consumer-groups` annotations for this:

```yaml
apiVersion: kafka.strimzi.io/v1alpha1
kind: KafkaTopic
metadata:
  name: new-orders
  annotations:
    consumer-groups: '["invoicing", "marketing"]'
    producer-groups: '["orders"]'
  labels:
    strimzi.io/cluster: my-cluster
spec:
  replicas: 3
  partitions: 12
```

The kube-mgmt sidecar will load these into the OPA where we can use them in our policy.
When the authorization request is for a topic, we will match the groups into which the user belongs against the groups allowed to produce or consume from given topic:

```rego
is_consumer_group {
    user_groups(principal.name)[_] == topic_consumer_groups(topic_name)[_]
}

is_producer_group {
    user_groups(principal.name)[_] == topic_producer_groups(topic_name)[_]
}

user_groups(user) = groups {
    groups := json.unmarshal(kafkausers[_][user].metadata.annotations["groups"])
}

topic_consumer_groups(topic) = groups {
    groups := json.unmarshal(kafkatopics[_][topic].metadata.annotations["consumer-groups"])
}

topic_producer_groups(topic) = groups {
    groups := json.unmarshal(kafkatopics[_][topic].metadata.annotations["producer-groups"])
}
```

The policy above will extract the groups from the custom resource annotations.
And see if there is any group shared between the user and the topic.
If any group is in both user groups and consumer or producer groups, the user will be allowed.

The admin operations are handled differently and any user who is member of the special group `admin` will be allowed to do the admin operations:

```rego
admin_groups := ["admin"]

is_admin_group {
    user_groups(principal.name)[_] == admin_groups[_]
}
```

Now we just need to use these rules to make the `allow` or `deny` decision:

```rego
allow {
    not deny
}

deny {
    not allow_consumer_topic
    not allow_consumer_group
    not allow_producer
    not allow_admin
}

allow_consumer_topic {
    is_topic_resource
    is_consumer_operation
    is_consumer_group
}

allow_consumer_group {
    is_group_resource
    is_consumer_operation
    startswith(group_name, principal.name)
}

allow_producer {
    is_topic_resource
    is_producer_operation
    is_producer_group
}

allow_admin {
    is_admin_operation
    is_admin_group
}
```

The full policy including some additional helper functions can be found on my [GitHub](https://github.com/scholzj/demo-opa-kafka-authorization/blob/master/advanced-example-policy.rego).

## Conclusion

The main advantage of Open Policy Agent authorization compared to the `simple` or Keycloak authorizers is its flexibility.
The examples from the previous section might not be exactly production grade.
But I think they very well demonstrate how easily you can use OPA and Rego to combine data from different sources and use them for the authorization decisions.

With the `simple` authorizer, you have to follow the ACL rules defined for each user and stored in ZooKeeper.
With Keycloak, you can use the permissions defined in Keycloak.
But with OPA, you can use any external data you want.
OPA calls this _context-aware authorization and decisions_.
You can [easily integrate](https://www.openpolicyagent.org/docs/latest/external-data/) OPA with different external data sources and use these data for the decision making to do exactly what you want.

The main disadvantage is that unless you are already using OPA for other applications, you will need to run yet another application.
But the great think is that Open Policy Agent has many integrations and can be used with many different applications and not just with Apache Kafka.
So you will most probably quickly find a lot more use-cases for it.

## Next time

In this blog post we focused on Open Policy Agent as authorization server for Apache Kafka clusters.
But Open Policy Agent can do more.
Next time we will look at other ways how OPA can help Strimzi users.