---
layout: post
title:  "Dynamically changeable logging levels"
date: 2020-11-02
author: stanislav_knot
---

Logging is an indisputably important feature for applications.
Logging monitors what the application is doing, but equally importantly, it logs what the application is not doing. 
Looking into application logs can help us prevent an application remaining or even getting into a faulty state.

<!--more-->


## Setting logging levels dynamically

There are many frameworks used for logging in Java applications, for example [`Logback`](http://logback.qos.ch/), [`tinylog`](https://tinylog.org/v2/), or [`log4j2`](http://logging.apache.org/log4j/2.x/index.html).
Kafka uses `log4j` and we decided to use newer version `log4j2` for Strimzi operator.
The main reason is using similar principles and format of configuration file.
Strimzi components are split into the two groups regarding which implementation of `log4j` they use.

`log4j`
- Kafka brokers
- Kafka Connect
- Kafka MirrorMaker2

`log4j2`
- Strimzi Kafka Bridge
- Topic Operator
- User Operator
- Strimzi Cluster Operator

`Log4j2` implementation supports dynamic reloading of logging configuration from properties file.
`Log4j` doesn't support reloading the whole log configuration from properties file, but it can be changed programmatically using the Log4j APIs.
And that is why each implementation requires a different approach, which we will look at now.

### Strimzi Cluster Operator

In order to change the Cluster Operator logging config, a simple change is required.
You have to configure the logging settings in the `ConfigMap` used for Cluster Operator configuration.
This `ConfigMap` is by default called `strimzi-cluster-operator`,
To edit the logging configuration use
```
$ kubectl edit cm strimzi-cluster-operator
```

Under the field `log4j2.properties` you should see current logging configuration.
Now you can edit this configuration to whatever you want with one exception.

The entry `monitorInterval` must stay in place.
When it is removed, the configuration will not be reloaded dynamically anymore.
To apply changes in such a case, the pod needs to be rolled. 

The second way to change `ConfigMap` is to modify the file `install/cluster-operator/050-ConfigMap-strimzi-cluster-operator.yaml`, and apply the changes by this command:

```
$ kubectl apply -f install/cluster-operator/050-ConfigMap-strimzi-cluster-operator.yaml
```

The same restrictions apply.
The entry `monitorInterval` must stay in place.

The change in logging takes some time to be applied. 
You can find out more in the implementation details section of this post.

### Topic Operator, User Operator and Kafka resources

The approach to changing the logging configuration of User Operator, Topic Operator, Kafka Bridge, Kafka brokers, Kafka Connect and Kafka MirrorMaker2 did not change.
The logging is still configurable via `inline` or `external` logging section of custom resource specification.

Example of `inline` logging.
```yaml
...
spec:
  logging:
    type: inline
      loggers:
        kafka.root.logger.level = INFO
...
```

Example of external logging.
```yaml
...
spec:
  logging:
    type: external
      name: my-external-config-map
...
```

Only loggers can be changed dynamically.
Logging appenders are changed using an external `ConfigMap` and the rolling update is triggered.

This does not apply for Kafka Bridge, User operator, Topic operator and Cluster operator.
Because these use `log4j2` framework, even logging appenders are changeable dynmaicaly.


## Verifying logging levels are set correctly

In most cases, it takes a few seconds to change the logging level, and then you can observe the change in the logs.
If you want to check the loggers and logging levels are changed, you can use these commands.

For Kafka brokers:

```
$ kubectl  exec <kafka-cluster-name>-kafka-0 -- bin/kafka-configs.sh --bootstrap-server <kafka-cluster-name>-kafka-bootstrap:9092 --entity-type broker-loggers --entity-name 0 --describe
```

For Kafka Connect you can get loggers information by accessing Connect API service:

```
$ kubectl exec -ti <kafka-connect-pod-name> -- curl http://localhost:8083/admin/loggers
```

Since Kafka MirrorMaker2 is based on the Kafka Connect, getting its loggers is very similar:
```
$ kubectl exec -ti <kafka-mirror-maker-2-pod-name> -- curl http://localhost:8083/admin/loggers
```

Strimzi Cluster Operator, Topic Operator, Entity Operator and Strimzi Kafka Bridge use automatic reloading of logging configuration.
The only way to check the logging configuration of these components is by looking into the pod for the file on the path `/opt/strimzi/custom-config/log4j2.properties`.
It should contain the configuration and the `monitorInterval` property.
Note that reconciliation time and `monitorInterval` value affect the time logging configuration to be reloaded.

## Implementation details

To implement dynamically changeable logging levels in Strimzi Cluster Operator, Topic Operator, Entity Operator and Strimzi Kafka Bridge we use the`log4j2` [automatic reconfiguration](https://logging.apache.org/log4j/log4j-2.1/manual/configuration.html#AutomaticReconfiguration) feature.

Automatic reloading works in these steps:
1. Logging configuration is changed in the custom resource
2. During reconciliation the `log4j2.properties`  file is remounted. It contains the configuration from the custom resource.
3. `log4j2` polls changes in the `log4j2.properties` file in an interval of `monitorInterval` seconds

For Kafka broker, Kafka Connect and Kafka MirrorMaker2 we use features already implemented from Kafka.
Logging configuration in Kafka Brokers is changed using `AdminClient`.
For more information, see [KIP-412](https://cwiki.apache.org/confluence/display/KAFKA/KIP-412%3A+Extend+Admin+API+to+support+dynamic+application+log+levels)

Kafka Connect and Kafka MirrorMaker2 logging configuration is changed using the REST API.
For more information, see [KIP-495](https://cwiki.apache.org/confluence/display/KAFKA/KIP-495%3A+Dynamically+Adjust+Log+Levels+in+Connect)

## Further steps

For now, there is no way to set logging configuration for Kafka MirrorMaker.
There is a [KIP-649](https://cwiki.apache.org/confluence/display/KAFKA/KIP-649%3A+Dynamic+Client+Configuration) in progress.
However, Kafka MirrorMaker support will eventually be dropped, as it has been replaced by MirrorMaker 2.0.

The inability to set logging configuration dynamically applies for the ZooKeeper as well.
Since there is [KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500%3A+Replace+ZooKeeper+with+a+Self-Managed+Metadata+Quorum) what should remove ZooKeeper, we do not consider it as priority to implement this feature for ZooKeeper cluster.

An upgrade to `log4j2` has been proposed: [KIP-653](https://cwiki.apache.org/confluence/display/KAFKA/KIP-653%3A+Upgrade+log4j+to+log4j2) arised.
It should make the changes in logging even simpler on the Kafka side.

## Conclusion

Whether Strimzi is running in development or production environments, it is useful to be able to set an appropriate logging level.
Sometimes a Kafka cluster or operator is driven into an edge case.
With a less informative logging level it can be difficult to investigate what happened and how this situation can be fixed.
Changing the logging level causes a rolling update of the pod, which can put the cluster in a regular state.
This complicates debugging the cause of such an event.
Furthermore, any reason to roll Kafka pods lowers the availability of Kafka cluster.
To fix all these issues it gives us a need to be able to apply logging configuration dynamically.
And that is the main reason why we decided to implement dynamic logging levels in Strimzi 0.20.0 by using methods described in this blogpost.