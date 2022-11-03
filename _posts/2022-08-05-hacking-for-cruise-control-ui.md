---
layout: post
title: "Hacking Strimzi for Cruise Control UI"
date: 2022-10-31
author: kyle_liberti
---

For some time now, Strimzi has used for [Cruise Control](https://github.com/linkedin/cruise-control) for automated partition rebalancing and has offered Strimzi custom resources for safely configuring, deploying, and communicating with Cruise Control through the Strimzi Operator.
These custom resources not only provide a strong abstraction leaving Cruise Control as an implementation detail but also offer great declaritive support.
That being said, it is sometimes a better user experience to interact with applications like Cruise Control through a graphical user interface.
LinkedIn provides such a [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) application which supports several Cruise Control operations like viewing Kafka cluster status, getting Kafka cluster load information at the broker and partition level, and executing partition rebalances, all with just a couple button clicks.
Although Strimzi does not offer direct support for the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) it can still be run alongside and connected to a Strimzi-managed Cruise Control instance.

This post will walk through how to do so! 

![Cruise Control Frontend]({{ "/assets/images/posts/2019-08-08-cruise-control-frontend.png" }})

## Motivation

Maybe you want a pretty dashboard to view your cluster status, maybe you want to preform Cruise Control operations without having to open a text editor, or maybe you are just a visual person, reguardless of the reason, we have been getting a lot of requests for how to set up the Cruise Control UI with a Strimzi-managed Kafka cluster.
We want to provide some basic instructions for getting you started!

## Prerequisites

For starters we will need a Strimzi-managed Kafka cluster with Cruise Control enabled.

```
                           *  *
                        *        *
                       *  Cruise  *
                       *  Control *
                        *        *
                           *  *
                            ^                   *  *         *  *          *  *
                            |                *        *   *        *    *        *
+----------+                |               *  Kafka   * *  Kafka   *  *  Kafka   *
|          |               *  *             *   Pod    * *   Pod    *  *   Pod    *
|  Kafka   |            *        *           *        *   *        *    *        *
| Resource | <------+  * Cluster  * ----->      *  *         *  *          *  *
|          | +------>  * Operator *
|          |            *        *              *  *         *  *          *  *
+----------+               *  *              *        *   *        *    *        *
                                            * Zookeeper* * Zookeeper*  * Zookeeper*
                                            *   Pod    * *   Pod    *  *   Pod    *
                                             *        *   *        *    *        *
                                                *  *         *  *          *  *

Kubernetes Land                                          Kafka Cluster
```
Since the [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) does not support HTTPS and Strimzi does not support creating custom Cruise Control API user roles we will need to disable Cruise Control SSL and HTTP basic authentication settings.

We can do so by configuring Cruise Control within a `Kafka` resource like this:

``` 
# kafka-cruise-control.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: my-cluster
spec:
  cruiseControl:
    config:
      webserver.security.enable: false
      webserver.ssl.enable: false  
```

## Cruise Control UI

With our Strimzi-managed Kafka cluster deployed, we can now create a Cruise Control UI instance to run alongside it.

```
    *  *                   *  *
 *       *              *        *
*  Cruise  *   +---->  *  Cruise  *
*  Control *   <----+  *  Control *
 *   UI  *              *        *
    *  *                   *  *
                            ^                   *  *         *  *          *  *
                            |                *        *   *        *    *        *
+----------+                |               *  Kafka   * *  Kafka   *  *  Kafka   *
|          |               *  *             *   Pod    * *   Pod    *  *   Pod    *
|  Kafka   |            *        *           *        *   *        *    *        *
| Resource | <------+  * Cluster  * ----->      *  *         *  *          *  *
|          | +------>  * Operator *
|          |            *        *              *  *         *  *          *  *
+----------+               *  *              *        *   *        *    *        *
                                            * Zookeeper* * Zookeeper*  * Zookeeper*
                                            *   Pod    * *   Pod    *  *   Pod    *
                                             *        *   *        *    *        *
                                                *  *         *  *          *  *

Kubernetes Land                                          Kafka Cluster
```

### Inside the Cruise Control UI container

Following the instructions on the [Cruise Control UI wiki](https://github.com/linkedin/cruise-control-ui/wiki/CCFE-(Dev-Mode)---Docker), we can configure an Nginx server as a reverse-proxy to forward Cruise Control UI requests to the Cruise Control REST API.

```
                                +-------------+
                                |             |      
+----------------+  GET /       |             |
|                |              |    nginx    |       
|   User / CCFE  +<------------>+             |       
|                |   CCFE FILES |             |       
+-------+--------+              |  10.0.0.4   |----------->
        ^                       |  port 80    |  CC REST API request     
        |                       |             |  (/kafkacruisecontrol)    
        |                       |             |   
        +---------------------->+             +        
      {GET,POST}                |             |      
      /kafkacruisecontrol       +-------------+

Cruise Control UI pod
```

### Building the Cruise Control UI container

We can build our own Cruise Control image with a configured NGINX server and Cruise Control UI binaries following the instructions on the [Cruise Control UI wiki](https://github.com/linkedin/cruise-control-ui/wiki/CCFE-(Dev-Mode)---Docker), creating a Dockerfile like the following:

```bash
# Dockerfile
FROM nginx

ENV CRUISE_CONTROL_UI_VERSION=0.4.0
ENV NGINX_HOME=/usr/share/nginx/html/

RUN curl -LO https://github.com/linkedin/cruise-control-ui/releases/download/v${CRUISE_CONTROL_UI_VERSION}/cruise-control-ui-${CRUISE_CONTROL_UI_VERSION}.tar.gz; \
    tar xvfz cruise-control-ui-${CRUISE_CONTROL_UI_VERSION}.tar.gz -C ${NGINX_HOME} --strip-components=2; \
    rm -f cruise-control-ui-${CRUISE_CONTROL_UI_VERSION}.tar.gz*; \
    echo "dev,dev,/kafkacruisecontrol/" > "${NGINX_HOME}"static/config.csv;

EXPOSE 80
```

Then building and pushing the image to a container registry
```
# When building, tag the image with the name of a container registry
# that is accessible by the Kubernetes cluster.
docker build . -t <registry>/<cruise-control-ui-image-name>

# Push the image to that container registry
docker push <registry>/<cruise-control-ui-image-name>
```

### Deploying the Cruise Control UI pod

Then we can create a `Deployment`, `ConfigMap`, and `Service` for running the Cruise Control UI:

```yaml
# cruise-control-ui.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cruise-control-ui
  labels:
    app: cruise-control-ui
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cruise-control-ui
  template:
    metadata:
      labels:
        app: cruise-control-ui
    spec:
      containers:
      - name: cruise-control-ui
        image: <registry>/<cruise-control-ui-image-name>
        ports:
        - containerPort: 80
        volumeMounts:
        - name: cruise-control-ui
          mountPath: /etc/nginx/conf.d
      volumes:
        - name: cruise-control-ui
          configMap:
            name: cruise-control-ui
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cruise-control-ui
  labels:
    app: cruise-control-ui
data:
  default.conf: |2+
        server {
        listen       80;
        listen  [::]:80;
        server_name  localhost;

        location / {
            root   /usr/share/nginx/html;
            index  index.html index.htm;
        }

        location /kafkacruisecontrol/ {
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_buffering off;
            proxy_pass http://my-cluster-cruise-control:9090/kafkacruisecontrol/;
        }
        
        error_page   500 502 503 504  /50x.html;
        location = /50x.html {
            root   /usr/share/nginx/html;
        }
        }
---
apiVersion: v1
kind: Service
metadata:
  name: cruise-control-ui
  labels:
    app: cruise-control-ui
spec:
  selector:
    app: cruise-control-ui
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
```

Then run it:
```
kubectl apply -f cruise-control-ui.yaml -n <namespace>
```

## Using Cruise Control Front End

After being deployed, port-forward the Cruise Control UI service to access it locally:

```
kubectl port-forward svc/cruise-control-ui 8090:80
```

Then navigate [‘http://127.0.0.1:8090’](http://127.0.0.1:8090) in your browser

![Cruise Control Frontend]({{ "/assets/images/posts/2019-08-08-cruise-control-frontend.png" }})

## Conclusion

Although it is possible to run a [Cruise Control UI](https://github.com/linkedin/cruise-control-ui) UI instance alongside a Strimzi-managed Kafka cluster it is only possible when the Cruise Control REST API security settings are disabled.
Having these security settings disabled exposes the Cruise Control API to potentially destructive Cruise Control operations that are not coordinated or supported by Strimzi Operator.
If using the Cruise Control UI with a Strimzi-managed Kafka cluster, it is best to stick with using it solely for monitoring your cluster, not for operating on it.
That being said, use at your own risk!
