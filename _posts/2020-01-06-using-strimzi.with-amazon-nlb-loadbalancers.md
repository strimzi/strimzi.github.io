---
layout: post
title:  "Using Strimzi with Amazon NLB load balancers"
date: 2019-12-29
author: jakub_scholz
---

Strimzi supports providing access to Kafka using load balancers.
We already have a [full blog post](https://strimzi.io/2019/05/13/accessing-kafka-part-4.html) dedicated to it.
But when running Strimzi on Amazon AWS, it will use by default the so called _Classic Load Balancer_.
However, lot of users seem to be asking about using the newer _Network Load Balancer_.
So in this blog post we will have a look whether and how Strimzi could work with network load balancers.

<!--more-->

## Network Load Balancers

Amazon AWS supports three types of load balancers:
* Classic Load Balancers
* Application Load Balancers
* and Network Load Balancers (NLB)

Application load balancer is Layer 7 load balancer and is best suited for load balancing HTTP and HTTPS traffic.
That makes is not suitable for use with Apache Kafka.
But both Classic and Network load balancers are Layer 4 load balancers (Classic load balancer supports also Layer 7 load balancing of HTTP / HTTPS) which are well suited for load balancing TCP connections including Kafka clients.

The Classic load balancer is the oldest type supported by AWS.
Network load balancer was added only later and has some additional features which are not supported by the Classic load balancer.
For example:
* Support for static IP addresses
* Deletion protection
* Preserving of source IP address
* Load balancing multiple ports on the same instance

Especially the last feature is interesting for use with Apache Kafka.
It allows you to have only one load balancer to handle the whole Kafka cluster.
With the Classic load balancer you would need a dedicated load balancer instance for each broker plus one additional instance for the bootstrap service.

Also the pricing is slightly different.
With the Classic load balancer, you pay $0.025 per hour (per instance) plus $0.008 for each processed GB of data.
With the Network load balancer, you pay $0.0225 per hour (per instance) plus $0.006 per a so called _LCU-hour_.
LCU-hour is a unit of scale for the load balancer.
One LCU hour includes 800 new TCP connections per second, 100,000 active TCP connections and 1 GB of processed data.
While the pricing mode is a little bit different, the NLB should be in most cases cheaper to use that the Classic load balancer.
_(The prices are for the US East region)_

For more detailed information about the different load balancer types in Amazon AWS and their pricing, please check the [AWS documentation](https://aws.amazon.com/elasticloadbalancing/features/).

## Using Strimzi with Network Load Balancer

In Kubernetes, when you create a service with type `Loadbalancer`, it will by default create the Classic Load Balancer.
For each service with given type it will create a separate load balancer instance.
But it is easy to change the type of the load balancer using a simple annotation set on the service.
To create a Network Load balancer, you have to set the annotation `service.beta.kubernetes.io/aws-load-balancer-type` to the value `nlb`.
For more details about the annotation see [Kubernetes documentation](https://kubernetes.io/docs/concepts/services-networking/service/#aws-nlb-support).

You can set the annotation easily in Strimzi using the [template feature](https://strimzi.io/docs/latest/full.html#assembly-customizing-deployments-str):

```yaml
    # ...
    listeners:
      # ...
      external:
        type: loadbalancer
        tls: false
    template:
      externalBootstrapService:
        metadata:
          annotations:
            service.beta.kubernetes.io/aws-load-balancer-type: nlb
      perPodService:
        metadata:
          annotations:
            service.beta.kubernetes.io/aws-load-balancer-type: nlb
    # ...
```

_(The example above has TLS and authentication disabled for simplicity)_

Once the cluster is deployed, you can easily connect to it:

```
$ bin/kafka-console-consumer.sh --bootstrap-server a83231a2e37594f3fbf5c6841de6f729-f13dac31e8214877.elb.us-east-1.amazonaws.com:9094 --topic my-topic --from-beginning
Hello
World
```

This will set the annotation on the services and get your Kubernetes cluster to create the Network load balancers instead of the Classic ones.
Apache Kafka and Strimzi will work with this out of the box without any additional changes.
However, it will still create a separate load balancer instance for each Kafka broker plus the additional one for the bootstrap service.

## Single Network Load Balancer for the whole Apache Kafka cluster

I didn't found any way how to tell Kubernetes to create only single NLB instance and share it with multiple services.
So we will need to approach this from a different end.
When you expose a Kubernetes service with load balancer, it essentially creates a node port service and the load balancer which it configures to route the data to the right node port.
So to workaround the limitations we can do the same manually.
We will:
* Expose Apache Kafka using node ports
* Create NLB and configure it to route the data to the node port services
* Configure the advertised addresses in Apache Kafka to use the NLB address instead of the node addresses and node ports

### Exposing Apache Kafka with node ports

First, we will deploy a regular Kafka cluster with node port access:

```yaml
    # ...
    listeners:
      # ...
      external:
        type: nodeport
        tls: false
    # ...
```

We will have to note the node port numbers for the node port services:

```
kubectl get service
NAME                                  TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)                      AGE
my-cluster-kafka-0                    NodePort    10.96.84.161   <none>        9094:31208/TCP               35m
my-cluster-kafka-1                    NodePort    10.96.63.131   <none>        9094:31983/TCP               35m
my-cluster-kafka-2                    NodePort    10.96.35.251   <none>        9094:32279/TCP               35m
my-cluster-kafka-bootstrap            ClusterIP   10.96.17.28    <none>        9091/TCP,9092/TCP,9093/TCP   35m
my-cluster-kafka-brokers              ClusterIP   None           <none>        9091/TCP,9092/TCP,9093/TCP   35m
my-cluster-kafka-external-bootstrap   NodePort    10.96.187.42   <none>        9094:32200/TCP               35m
my-cluster-zookeeper-client           ClusterIP   10.96.58.200   <none>        2181/TCP                     36m
my-cluster-zookeeper-nodes            ClusterIP   None           <none>        2181/TCP,2888/TCP,3888/TCP   36m
```

In my case, it is:
* `32200`
* `31208`
* `31983`
* `32279`

We will need this in the next step.

### Creating and configuring the NLB

Next, we have to create the Network load balancer.
In the Amazon AWS console, go to the _Load Balancer_ section of the EC2 dashboard and create a new load balancer with the _Create Load Balancer_ button.
In the wizard, select a _Network Load Balancer_:

![Selecting the load balancer type]({{ "/assets/2020-01-06-nlb-create-wizard-type.png" }})

And configure the details of the load balancer:
* Pick your own name for the load balancer. 
I named it `my-cluster-kafka`.
* Create one listener for each broker plus one additional as bootstrap. 
All listeners should use the TCP protocol. 
My Kafka cluster has 3 brokers, so I configured 4 listeners on ports `9092`, `19092`, `29092` and `39092`.
* Select the right VPC where your Kubernetes cluster runs and select all availability zones which it is using.

And click _Next: ..._.

![Configure listeners, VPC and subnets]({{ "/assets/2020-01-06-nlb-create-wizard-listeners.png" }})

Skip the security configuration since we do not use any TLS listeners and click _Next: ..._ again to configure routing:
* Name the first _Target Group_ which will be used for the bootstrap service. 
I named it `my-cluster-bootstrap`.
* Select the target type as _Instance_.
* Select the _TCP_ protocol.
* As port, use the port number of the bootstrap service.
In my case `32200`.

And press the _Next: ..._ button.

![Configure target group]({{ "/assets/2020-01-06-nlb-create-wizard-target-group.png" }})

Now we have to add the target instances:
* Select the nodes where your Kafka cluster might run. 
This could be all your worker nodes or only some of them if you use node selectors to run Kafka only on some dedicated nodes.
* Press the _Add to registered_ button.

![Register Kubernetes nodes]({{ "/assets/2020-01-06-nlb-create-wizard-register-targets.png" }})

After you selected the nodes, press the _Next: ..._ button, review the NLB and if everything looks ok, press the _Create_ button to confirm the creation.

![Review the new Network load balancer before creating it]({{ "/assets/2020-01-06-nlb-create-wizard-review.png" }})

Now you should see the load balancer being provisioned.
That takes normally few minutes and when it is done the _State_ changes to _active_.

![Wait for the load balancer provisioning to finish]({{ "/assets/2020-01-06-nlb-provisioning.png" }})

However, in the wizard, we created only the target group for the bootstrap service.
We will need to create the target groups also for the different brokers.
That can be done in the _Target Groups_ section of the EC2 dashboard.
When you go there, you should already see the bootstrap load balancer there.

![Overview of the target groups]({{ "/assets/2020-01-06-nlb-target-groups.png" }})

Click the _Create Target Group_ button and in the wizard fill in following fields:
* Enter the name for your target group. 
I my case I used `my-custer-kafka-0`.
* Select the _Target type_ as _Instance_.
* Select _TCP_ as _Protocol_.
* As a _Port_, use the node port of your broker service with index 0. 
In my case it is `31208`.
* And select the VPC where your Kafka cluster runs.

![Create additional target groups]({{ "/assets/2020-01-06-nlb-create-target-group.png" }})

After you filled in all the fields, press the _Create_ button to create the target group.
Once the _Target Group_ is created, we have to register the targets with it.
In the _Targets_ tab in the details of the selected _Target Group_, press the _Edit_ button to register new targets

![Check the target group registered instances]({{ "/assets/2020-01-06-nlb-target-group-targets.png" }})

Select the same instances as you did for the bootstrap target and save them.

![Register new instances]({{ "/assets/2020-01-06-nlb-create-target-group-register-targets.png" }})

In the same way we need to add two more _Target groups_ for brokers 1 and 2.
Now with the target groups ready, we have to register them with the listeners.
To do that, go to back to the _Load Balancers_ section, select the load balancer we created and in the detail go to the _Listeners_ tab.
Select the listener for port `9093` and press the _Edit_ button.

![Check the listeners]({{ "/assets/2020-01-06-nlb-listeners-tab.png" }})

In the window for editing the listener, first delete the bootstrap target group which is selected there, than select new _Forward_ rule to the target group for the broker 0 and click the _Update_ button.
Repeat this for the listeners `9094` and `9095` and configure them to forward traffic to the target groups for brokers `1` and `2`

![Edit the listeners]({{ "/assets/2020-01-06-nlb-edit-listener.png" }})

Last thing we need to do is to go and configure the security groups of the Kubernetes worker nodes to allow traffic from the clients and from the load balancer.
We will need to first find out the internal IP address(es) of our load balancer to get the health checks to work.
You can find them in the _Network Interfaces_ section of the EC2 dashboard.
You should see there one or more network interfaces of the load balancer we created.
You should be able to easily recognize them from the description which will say something like `ELB net/my-cluster-kafka/36203843994a2519`.
The number of network interfaces depends on the number of availability zones / subnets you configured the load balancer for.
My cluster runs in 3 zones, so I have 3 network interfaces.
After selecting the interface, you should see the private IP address of the interface (as _Primary private IPv4 IP_).
Note these addresses for all your network interfaces. In my case it was:
* `10.0.1.27`
* `10.0.0.210`
* `10.0.2.117`

![Find the network interfaces]({{ "/assets/2020-01-06-nlb-network-interfaces.png" }})

Now we have to go to the _Security Groups_ section and edit the security group used by your Kubernetes worker nodes.
In my case, it is just one security group for all nodes called `my-kubernetes`.
But it might be different in your case depending on how you deployed your Kubernetes cluster.
In the security group detail, select the _Inbound_ tab and click the _Edit_ button.

![Edit the security groups]({{ "/assets/2020-01-06-nlb-security-groups.png" }})

We will need to add several new rules here for each node port.
Press the _Add rule_ button to add a new rule.
First we need to add rules for the load balancer:
* _Type_ set as _Custom TCP_
* _Protocol_ set as _TCP_
* In _Port range_ enter the node port number
* In _Source_ select _Custom_ and enter the IP address of the network interface in the CIDR notation - for example as `10.0.1.27/32`.

These rules need to be added for each network listener IP and each node port.
So in my case with 3 brokers plus the bootstrap service and 3 network interfaces, I will need to add in total 12 rules.
If you are lazy like me and doing this only on your test cluster, you can also use a CIDR range such as `10.0.0.0/16` to add all network interfaces in one rule.
You can also specify a range for the node ports instead of configuring them one by one.

After enabling the load balancer to talk with the node ports, we will also need to allow the clients to talk with the brokers.
Unlike the Classic Load Balancer, the Network Load Balancer doesn't have it's own security group to configure the clients which can access it separately.
The client IP addresses need to be configured directly in the EC2 security group.
Therefore we need to add the same rules as we added for the load balancer also for the client. 
The only different is that this time instead of the load balancer IP address we have to use the CIDR range from which our clients will connect.
In my case, the client will connect from `88.208.0.0/16`.

![Add the security group rules]({{ "/assets/2020-01-06-nlb-security-group-rules.png" }})

Once you have all the rules prepared, don't forget to press the _Save_ button to save the changes.
Once you save the rules, we should have the Network load balancer prepared.
But we still need to configure the Kafka broker to use the load balancer as the advertised address.

### Configuring the advertised addresses

The advertised address is a configuration in the Kafka brokers which is used to tell the clients how to connect to the broker.
Since we configured the Kafka cluster with node ports, it will by default use the address of the Kubernetes node and the node port of the service as the advertised address.
We need to reconfigure the advertised address to route the traffic through the load balancer.
To do so, we will need to grab the load balancer address from the AWS console.
In my case, the address is `my-cluster-kafka-36203843994a2519.elb.us-east-1.amazonaws.com`.
To configure the advertised address, we will need to edit the Kafka custom resource and set the [advertised listener overrides](https://strimzi.io/docs/latest/full.html#con-kafka-broker-external-listeners-addresses-deployment-configuration-kafka) to the load balancer address and to the listener ports (in our case `9093`, `9094` and `9095`):

```yaml
# ...
listeners:
  # ...
  external:
    type: nodeport
    tls: false
    overrides:
      brokers:
      - broker: 0
        advertisedHost: my-cluster-kafka-36203843994a2519.elb.us-east-1.amazonaws.com
        advertisedPort: 19092
      - broker: 1
        advertisedHost: my-cluster-kafka-36203843994a2519.elb.us-east-1.amazonaws.com
        advertisedPort: 29092
      - broker: 2
        advertisedHost: my-cluster-kafka-36203843994a2519.elb.us-east-1.amazonaws.com
        advertisedPort: 39092
# ...
```

Once we change the configuration, a rolling update will be needed to apply these changes.

### Connecting with clients

Once the rolling update is finished, we should be able to connect:

```
$ bin/kafka-console-consumer.sh --bootstrap-server my-cluster-kafka-36203843994a2519.elb.us-east-1.amazonaws.com:9092 --topic my-topic --from-beginning
Hello
World
```

## Are there any real advantages?





