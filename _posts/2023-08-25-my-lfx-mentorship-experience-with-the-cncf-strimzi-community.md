---
layout: post
title: "Navigating the Open Source Seas: My LFX Mentorship Experience with the CNCF Strimzi Community"
date: 2023-08-25
author: antonio_pedro
---

In the world of open-source software, collaboration and mentorship play a pivotal role in driving innovation and fostering growth. 
As an aspiring developer looking to dive into the intricate world of cloud-native technologies, I embarked on a remarkable journey by participating in the [LFX Mentorship](https://lfx.linuxfoundation.org/tools/mentorship) program with the [Strimzi](https://strimzi.io) community.
This program happens thrice a year and is organized by [The Linux Foundation](https://www.linuxfoundation.org/).
This blog post aims to shed light on my enriching experience, highlighting the valuable insights gained, the impactful work undertaken, and the immeasurable support from my mentors and the Strimzi community.

<!--more-->

### LFX Mentorship and the Cloud Native Computing Foundation Strimzi Community

The Linux Foundation Mentorship is a 12-week online program to empower students to contribute to open-source projects under CNCF, the [Cloud Native Computing Foundation](https://www.cncf.io/).

Strimzi is a CNCF sandbox project that focuses on providing operators for running Apache Kafka on Kubernetes.
With my interest piqued by this innovative endeavor, I decided to join the Strimzi community through the LFX Mentorship program.

The LFX mentorship program links budding developers and experienced mentors, providing an avenue to contribute meaningfully to open-source projects.

### The application process

Everything started in 2022, when I was looking for things I could do during my summer holidays.
I investigated some mentorship programs such as Google Summer of Code, MLH Fellowship, Outreachy, and LFX Mentorship.
I was looking for a program that would allow me to work on a project that I was passionate about and that would help me grow as a developer.

I selected two projects for which my skill set mapped the recommended skills.
Among them, the Strimzi project was there waiting for me:

`“CNCF - Strimzi: Proof of Concept of an MQTT to Apache Kafka bridge for producing messages.”`

This project got my attention among all the projects because I had practical experience with MQTT from my undergraduate program.
I learned the basic concepts of Apache Kafka from the Cloud Computing and Distributed System course at IIIT Delhi.
You can find more information about the project [here](https://mentorship.lfx.linuxfoundation.org/project/8d301adf-94d8-4e5d-821d-f904ed15c3f9).

After understanding what I had to do and what the project was about, I had to prepare my cover letter and resume.
You need to submit these essential documents while applying to the LFX mentorship.
I ensured my cover letter and resume were well-aligned with the project by providing details about my skills and experience with the recommended skills.

But just after submitting my application, I noticed that one of the mentors for my project commented on the weak selection process.
He was asking if the program should have a project design proposal as a prerequisite just like in Google Summer of Code.
A design proposal contains an overall description about the project, the challenges and related solutions.
It's a good place to start a discussion with mentors in order to understand how the mentee would approach the project.

![Mentor's GitHub comment](/assets/images/posts/2023-08-25-github-comment.png)

This scared me :) But I was confident I could provide a good proposal because of my previous experience with the underlying technologies.

On the same day, I got my first interaction with my mentors. Little did I know that it would not be the last.

![Mentor's email asking for a proposal](/assets/images/posts/2023-08-25-mentor-email.png)

The first task was understanding the real problem and why we would need to build such a bridge, so I researched that.
To design the solution, my first intuition was to relate my college project to the project.
Just to get a rough idea of how similar it was to what I was building in college:

![Architecture of a system using MQTT](/assets/images/posts/2023-08-25-design-of-a-system-using-mqtt.png)

After that, I started to think about the architecture of the solution, and I came up with this:

![Strimzi MQTT Bridge](/assets/images/posts/2023-08-25-mqtt-bridge-high-architecture.png)

To be even closer to a logical solution, the win-win was to study and understand how Strimzi HTTP-Kafka Bridge works and how it is deployed on Kubernetes. 
After reading the Strimzi HTTP-Kafka Bridge documentation, I was able to design a Bridge tackling all the issues. 
Of course, it was not perfect, and this is where discussing my solution with the mentors helped me.

#### Mentor feedback

After submitting my proposal, I got feedback from my mentors, which was overwhelmingly positive.
They had lots of comments about my approach. Discussing and resolving their concerns was, of course, part of my win-win.
At some point, I thought I wouldn’t be selected because my initial approach was mentioning unnecessary things like a full MQTT broker.

The feedback from my mentors allowed me to rethink and defend my approach, proving that I had a basic understanding and was keen to work on the project.

#### The great day

After so many discussions on the right approach, feedback, etc., I could not sleep whilst waiting for my results. 
My first result related to a submission for a CNCF Landing Page Improvement, for which I got rejected :(. 

I waited with nervous anticipation for the Strimzi result.
Waking up super early, I opened the email, and the great news was there:

![Acceptance email](/assets/images/posts/2023-08-25-acceptance-email.png)

### The mentorship journey

Upon joining the Strimzi community, I was warmly welcomed by mentors who were experts in their fields and exceptionally supportive and approachable.
With their sense of humor, they gave me comprehensive guidance on understanding the Strimzi project governance, setting up a repository for the project I worked on, etc.
A big shout-out to [kyguy](https://github.com/kyguy) and [ppatierno](https://github.com/ppatierno) for being my mentors and guiding me throughout the mentorship journey.
This initial interaction set the tone for a productive and collaborative mentorship journey.

#### The work undertaken

The project I worked on was the MQTT-Kafka Bridge, which is a bridge that allows you to produce messages to Kafka topics using the MQTT protocol.
As I said before, I had to improve my solution, which could have been more manageable with many unnecessary components.
Still, with the guidance of mentors, I could break down the task into manageable components.
The mentors' feedback and code reviews were instrumental in refining my work and aligning it with Strimzi’s high standards.

This MQTT-Kafka Bridge will enable one-way communication and mapping between MQTT and Kafka topics.
The transformed messages will simultaneously be delivered to the Kafka cluster by the Kafka producer.
This mapping makes it possible to integrate MQTT-based devices into an Apache Kafka system with interoperability, flexibility, and scalability.
It would enable users to take advantage of the benefits of both MQTT and Kafka in their data processing and IoT system scenarios.

This is what I worked on during each week.

![Mentorship tasks](/assets/images/posts/2023-08-25-mentorship-tasks-timeline.png)

The Bridge relies on a `Mapper` component to map the incoming MQTT messages to a valid Kafka Record, providing the following capabilities:
- **Interoperability**, such as MQTT QoS, Kafka Producer Acks level, and MQTT wildcards topics
- **Flexibility** for the user to set his own topic mapping rules

The user-defined `“topic mapping rules”` is a JSON array containing rules to define how the user wants to map each MQTT topic to a Kafka Topic.
Working on this project also helped me shape my understanding and gain hands-on experience with integration testing. 
I also enjoyed deploying the Bridge: packaging the Java application, building a container image, pushing it to a registry, and deploying the container on Kubernetes.  

#### Mentorship and collaboration

No doubt, my mentors were the best part of my mentorship journey. 
I have them as my sensei because they played a crucial role in shaping my understanding of the technical aspects and the open source culture.
Their patience in answering my queries, willingness to guide me through challenges, and encouragement to explore different approaches were invaluable.
This collaborative environment extended beyond my immediate mentors, as the Strimzi community was always ready to provide insights and support whenever I reached out.
And, of course, I am glad I can count on my mentors and the Strimzi community even after the mentorship.

Through the LFX Mentorship program, I honed my technical skills, project management capabilities, and collaboration proficiency.
The experience of working alongside experienced professionals taught me best practices, code organization, and the importance of maintaining clean and well-documented code.

#### The weekly meetings

The weekly meetings were the best part of the mentorship program.
I had the opportunity to interact with the mentors, which was a great learning experience.
The meetings were very productive, and I got to learn a lot from them.
During the meetings, we discussed the progress made, the challenges faced, and the next steps to be taken.
The mentors were very supportive and provided valuable feedback and guidance.

#### The result

The result was a bridge that allows you to produce messages to Kafka topics using the MQTT protocol.
You can find the code [here](https://github.com/strimzi/strimzi-mqtt-bridge).

The video below illustrates the workings of the MQTT-Kafka Bridge.
It shows an Arduino device with three different sensors publishing data through the bridge and a Kafka consumer consuming these data. 

<iframe width="560" height="315" src="https://www.youtube.com/embed/VdNLLCVxbC8" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

### Conclusion

Participating in the LFX Mentorship program with the Strimzi community was a transformative experience that expanded my horizons and solidified my passion for open-source development.
The guidance, mentorship, and camaraderie from the mentors and the Strimzi community were invaluable to my growth.
Reflecting on this journey, I am grateful for the opportunity to contribute to a remarkable project while surrounded by a community that embodies the true spirit of open-source collaboration.
This experience has enriched my technical knowledge and inspired me to continue my journey as a proactive contributor to the open-source ecosystem. 

### What's next?

During and after this fantastic journey, many good things happened:
- I founded the first [Angolan open-source community](https://github.com/angolaosc) to educate, promote and help students and professionals get involved in open-source development:
I started the community in July, and by the end of my internship (late August), we had achieved the following:
    - Introduced the concept of open-source to 200+ individuals
    - Helped more than 20 individuals make their first contribution 
    - Grown our audience on social media by 700+ followers on LinkedIn and a discord community with 200+ members
- Also, I was invited to present what I did in the mentorship during the Strimzi Community meeting.
- Even further, I applied to be a core organizer for the [Cloud Native - Community Group Luanda](https://community.cncf.io/cloud-native-luanda) and got accepted.

I have embarked on a new journey as Open-source Program Manager at [Angola Open-source Community](https://github.com/angolaosc), where I am working on building a community of open-source enthusiasts in Angola.

I am very grateful for the opportunity to be part of the Strimzi community and the LFX Mentorship program.
I am looking forward to continuing my journey as a proactive contributor to the open-source ecosystem and contributing to the Strimzi community.

If you are looking for mentorship opportunities with CNCF, I wrote a comprehensive guide on how to apply and be successful.
You can find the blog [here](https://antonio-pedro2019z.medium.com/exploring-mentorship-opportunities-with-cncf-your-path-to-growth-1df69ebe3124)
