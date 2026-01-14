---
layout: post
title:  "Server-Side Apply in Strimzi"
date: 2026-01-14
author: lukas_kral
---

Kubernetes operators create, update, and delete resources to reflect the desired state defined by users.
When a particular resource is managed by a single operator (or a single user), conflicts during updates are relatively rare. 
However, problems arise when multiple actors - such as different operators or automation tools - modify the same resource.

With client-side apply, even changes to different fields can unintentionally overwrite each other. 
This behavior is especially problematic when multiple reconciliation loops are involved, as one operator may repeatedly revert changes made by another. 
This is the case with client-side apply as used in Strimzi.

## Client-side apply in Strimzi

When user creates or updates Strimzi resource, the desired state is taken by Strimzi and propagated into all needed resources.
For example (based on the configuration), when user updates field in `Kafka` CR, Strimzi will build from scratch resources like `StrimziPodSet`, `ConfigMap`, `Service`, or `PersistentVolumeClaim`.
This is completely fine until there is another operator, running in loop, updating these resources with another value.
Such example could be ArgoCD updating resources with annotations it needs for its functionality.
But with every update like this, Strimzi, because it gets event that the resource has changed, builds the resource by the desired state from scratch again, overwriting the changes made by other operator.
And this can lead into infinite loop of updates, various warnings or errors in other services/operators, and more.

Because of these issues, we decided to implement Server-Side Apply.

## What is Server-Side Apply?

Server-Side Apply (SSA) allows multiple actors to update the same Kubernetes resource while managing different fields. 
Instead of applying a full object update, each actor applies only the fields it owns, identified by a field manager. 
Kubernetes then tracks field ownership and detects conflicts when multiple actors attempt to manage the same field.

For operators, this provides a clear ownership model. 
An operator like Strimzi can manage only the fields it is responsible for, without overwriting changes made to other fields by users or other controllers.

At the same time, this model assumes that other actors modify only fields they are responsible for. 
If another operator updates fields that are essential for Strimzi’s functionality, it may still lead to misconfiguration. 
However, SSA makes such ownership boundaries explicit and visible, which helps surface these issues earlier and makes them easier to reason about.

## Implementation of Server-Side Apply in Strimzi

Originally, there was a proposal and a plan to implement Server-Side Apply for all resources managed by Strimzi. 
However, the scope of such a change turned out to be too large, so we decided to split the implementation into multiple phases.

In the first phase, we implemented Server-Side Apply for the following resources:

* `PersistentVolumeClaim`
* `ServiceAccount`
* `Service`
* `Ingress`
* `ConfigMap`

These resources were identified as the most problematic based on GitHub issues, community discussions, and feedback from users on our Slack channels. 
To minimize risk and avoid unexpected behavior, switching to Server-Side Apply is gated behind a feature gate called `ServerSideApplyPhase1`.

When this feature gate is enabled, the Cluster Operator uses SSA only for these resources, applying changes declaratively instead of rebuilding the entire resource from scratch.
The SSA implementation in Strimzi ensures that fields managed by Strimzi are always reconciled to the desired state, even in the presence of conflicts. 

The reconciliation flow is as follows:

* Strimzi first attempts to apply the change using Server-Side Apply without forcing ownership. 
* If no conflict occurs, the patch is applied and reconciliation continues. 
* If a conflict is detected, the Cluster Operator logs the error and retries the apply operation with force enabled. 
* When force is used, the affected field is updated and an explicit log entry is emitted to make this behavior visible to users.

This approach ensures that Strimzi can reliably configure the fields required for correct cluster functionality, while still allowing other actors to manage fields outside of Strimzi’s ownership.

## How it works in practice?

Theory is nice, but let’s see Server-Side Apply in action.
To try out this feature, you first need to enable the `ServerSideApplyPhase1` feature gate, as mentioned earlier, in the Deployment of the Strimzi Cluster Operator:

```yaml
...
- name: STRIMZI_FEATURE_GATES
  value: "+ServerSideApplyPhase1"
...
```

With Server-Side Apply enabled in the Cluster Operator, we can test it on one of the resources listed above.
For this example, I created an ephemeral Kafka cluster from the Strimzi examples.

As a simple test case, we will add a custom annotation to the `-kafka-bootstrap` Service. 
Before doing that, let’s inspect the current `.metadata` section of the resource.

```shell
> kubectl get service
NAME                         TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)                                        AGE
my-cluster-kafka-bootstrap   ClusterIP   X.X.X.X         <none>        9091/TCP,9092/TCP,9093/TCP                     9m17s
my-cluster-kafka-brokers     ClusterIP   None            <none>        9090/TCP,9091/TCP,8443/TCP,9092/TCP,9093/TCP   9m17s

> kubectl get service my-cluster-kafka-bootstrap -o jsonpath='{.metadata}' | jq
{
  "annotations": {
    "strimzi.io/discovery": "[ {\n  \"port\" : 9092,\n  \"tls\" : false,\n  \"protocol\" : \"kafka\",\n  \"auth\" : \"none\"\n}, {\n  \"port\" : 9093,\n  \"tls\" : true,\n  \"protocol\" : \"kafka\",\n  \"auth\" : \"none\"\n} ]"
  },
  ...
  "managedFields": [
    {
      "apiVersion": "v1",
      "fieldsType": "FieldsV1",
      "fieldsV1": {
        "f:metadata": {
          "f:annotations": {
            "f:strimzi.io/discovery": {}
          },
          ...
      "manager": "strimzi-kafka-operator",
      "operation": "Apply"
    },
    ...
  ]
}
```

At this point, the Service contains a single annotation, `strimzi.io/discovery`.
The `managedFields` section shows that this annotation is owned by the `strimzi-kafka-operator` field manager and was applied using Server-Side Apply.

Now let’s simulate another actor updating the same resource by adding a custom annotation using SSA.

```shell
> kubectl patch service my-cluster-kafka-bootstrap \                                                                                                                                                    
  --field-manager=different-agent \
  -p '{
    "apiVersion": "v1",
    "kind": "Service",
    "metadata": {
      "name": "my-cluster-kafka-bootstrap",
      "annotations": {
        "my.annotation/some": "value"
      }
    }
  }'
```

The `--field-manager` flag identifies the actor performing the change.
If we inspect the metadata again, we can see that the annotation was added and is now owned by a different field manager.

```shell
> kubectl get service my-cluster-kafka-bootstrap -o jsonpath='{.metadata}' | jq
{
  "annotations": {
    "my.annotation/some": "value",
    "strimzi.io/discovery": "[ {\n  \"port\" : 9092,\n  \"tls\" : false,\n  \"protocol\" : \"kafka\",\n  \"auth\" : \"none\"\n}, {\n  \"port\" : 9093,\n  \"tls\" : true,\n  \"protocol\" : \"kafka\",\n  \"auth\" : \"none\"\n} ]"
  },
  ...
  "managedFields": [
    ...
    {
      "apiVersion": "v1",
      "fieldsType": "FieldsV1",
      "fieldsV1": {
        "f:metadata": {
          "f:annotations": {
            "f:my.annotation/some": {}
          }
        }
      },
      "manager": "different-agent",
      "operation": "Update",
      "time": "2026-01-14T00:54:46Z"
    }
```

Without Server-Side Apply, Strimzi would not track ownership of individual fields, and this custom annotation would likely be removed during the next reconciliation.

### Handling the conflicts

Now let’s see what happens when another actor attempts to modify a field owned by Strimzi.

```shell
> kubectl patch service my-cluster-kafka-bootstrap \                                                                                                                                                     
  --field-manager=different-agent \
  -p '{
    "apiVersion": "v1",
    "kind": "Service",
    "metadata": {
      "name": "my-cluster-kafka-bootstrap",
      "annotations": {
        "strimzi.io/discovery": "this-is-wrong"
      }
    }
  }'
```

At this point, the annotation is updated:

```shell
> kubectl get service my-cluster-kafka-bootstrap -o jsonpath='{.metadata}' | jq
{
  "annotations": {
    "my.annotation/some": "value",
    "strimzi.io/discovery": "this-is-wrong"
  },
  ...
}
```

During the next reconciliation, Strimzi detects a conflict on the `strimzi.io/discovery` annotation. 
Since this field is owned by Strimzi, the operator logs a warning and retries the apply operation with `force` enabled:

```shell
2026-01-14 01:01:09 DEBUG AbstractNamespacedResourceOperator:280 - Reconciliation #68(timer) Kafka(test-suite-namespace/my-cluster): Service test-suite-namespace/my-cluster-kafka-bootstrap is being patched using Server Side Apply
2026-01-14 01:01:09 WARN  AbstractNamespacedResourceOperator:286 - Reconciliation #68(timer) Kafka(test-suite-namespace/my-cluster): Service test-suite-namespace/my-cluster-kafka-bootstrap failed to patch because of conflict: Failure executing: PATCH at: https://X.X.X.X:443/api/v1/namespaces/test-suite-namespace/services/my-cluster-kafka-bootstrap?fieldManager=strimzi-kafka-operator&force=false. Message: Apply failed with 1 conflict: conflict with "different-agent" using v1: .metadata.annotations.strimzi.io/discovery. Received status: Status(apiVersion=v1, code=409, details=StatusDetails(causes=[StatusCause(field=.metadata.annotations.strimzi.io/discovery, message=conflict with "different-agent" using v1, reason=FieldManagerConflict, additionalProperties={})], group=null, kind=null, name=null, retryAfterSeconds=null, uid=null, additionalProperties={}), kind=Status, message=Apply failed with 1 conflict: conflict with "different-agent" using v1: .metadata.annotations.strimzi.io/discovery, metadata=ListMeta(_continue=null, remainingItemCount=null, resourceVersion=null, selfLink=null, additionalProperties={}), reason=Conflict, status=Failure, additionalProperties={})., applying force
```

After the forced apply, Strimzi restores the correct value of its managed annotation, while the custom annotation remains untouched:

```shell
> kubectl get service my-cluster-kafka-bootstrap -o jsonpath='{.metadata}' | jq
{
  "annotations": {
    "my.annotation/some": "value",
    "strimzi.io/discovery": "[ {\n  \"port\" : 9092,\n  \"tls\" : false,\n  \"protocol\" : \"kafka\",\n  \"auth\" : \"none\"\n}, {\n  \"port\" : 9093,\n  \"tls\" : true,\n  \"protocol\" : \"kafka\",\n  \"auth\" : \"none\"\n} ]"
  },
  ...
}
```

This example demonstrates how Server-Side Apply allows Strimzi to reliably enforce the fields it owns, while safely coexisting with other actors managing the same resource.

## Conclusion

In this blog post, we introduced Server-Side Apply and showed how it is used in Strimzi, how it can be enabled, and how it can make working with Strimzi easier - especially in environments where multiple operators modify the same Kubernetes resources.
Although Server-Side Apply is not a new feature and has been available in Strimzi since version 0.48.0, it is still in the alpha stage and ready for broader testing. 
Before moving it to beta and continuing with the next implementation phases, we would like to hear from users whether it works as expected and which other resources they consider problematic.

You can share your feedback with us on Slack, or by opening a discussion or an issue on GitHub if you encounter any problems or have suggestions related to Server-Side Apply in Strimzi.