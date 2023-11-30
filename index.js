import axios from 'axios';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { Storage } from '@google-cloud/storage';
import AWS from 'aws-sdk';
import nodemailer from 'nodemailer';
import { Buffer } from 'buffer';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import fetch from 'node-fetch';


const mailgun = new Mailgun(FormData);
const mailgunApiKey = process.env.API_KEY;
const mailgunDomain = process.env.DOMAIN_NAME;
const mg = mailgun.client({ username: "api", key: mailgunApiKey });


const base64_encoded_key = process.env.GOOGLE_CREDENTIALS
const decodedKeyBuffer = Buffer.from(base64_encoded_key, 'base64');
const decodedKeyStr = decodedKeyBuffer.toString('utf-8');
const decodedKeyObject = JSON.parse(decodedKeyStr);
const bucketName = process.env.BUCKET_NAME;
const user_id = process.env.USER_ID;
// const googleCloudKey = JSON.parse(process.env.dev)

const s3 = new AWS.S3();
const storage = new Storage({
  credentials: decodedKeyObject,
});
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const transporter = nodemailer.createTransport({
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false, // Set to true if using SSL/TLS
    auth: {
      user: process.env.USER_ID,
      pass: process.env.PASSWORD,
    },
  });
  
  export const handler = async (event, context) => {
    try {
      const snsMessage = JSON.parse(event.Records[0].Sns.Message);
      console.log(snsMessage);
      const submission_url = snsMessage.submission_url;
      console.log(submission_url);
      const emailID = snsMessage.emailID;
      console.log(emailID);
    
      // Download release from GitHub
      const result = await gcp_upload(emailID, submission_url)
      
      // Email the user about the status of the download
      const status = await sendEmail(emailID, 'Assignment Download Status', result.msg);
  
      // Track the email in DynamoDB
      await trackEmail(emailID, 'Assignment Download Status', submission_url, status.body, context);
  
      return { statusCode: 200, body: 'Success' };
    } catch (error) {
      console.error('Error:', error);
      return { statusCode: 500, body: `Internal Server Error: ${error}` };
    }
  };
  
  export async function gcp_upload(emailID, submission_url) {
    try {
      const releaseResponse = await fetch(submission_url);
      if(!releaseResponse.ok){
        return { 
          statusCode: 400, 
          msg: `Unable to fetch the file. Please check your submission url and try again}` 
        }
      }
      const releaseDataArrayBuffer = await releaseResponse.arrayBuffer();
      const releaseData = Buffer.from(releaseDataArrayBuffer);
      const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "");
      const gcsFileName = `${emailID}/release_${timestamp}.zip`;
      const result = await storage.bucket(bucketName).file(gcsFileName).save(releaseData);
      return {
        statusCode: 200,
        msg: `Successfully uploaded the file to GCS Bucket: ${bucketName}/${gcsFileName}`,
      };
    } catch (error) {
      console.error('Error:', error);
      return { 
        statusCode: 500, 
        msg: `Unable to upload the file due to following error: ${error}` };
    }
  }

  // export async function gcp_upload(emailID, submission_url) {
  //   try {
  //     // Using axios.get instead of fetch
  //     const releaseResponse = await axios.get(submission_url, { responseType: 'arraybuffer' });
  
  //     if (!releaseResponse.status === 200) {
  //       return {
  //         statusCode: 400,
  //         msg: `Unable to fetch the file. Check your submission url: ${submission_url}`,
  //       };
  //     }
  
  //     const releaseDataArrayBuffer = releaseResponse.data;
  //     const releaseData = Buffer.from(releaseDataArrayBuffer);
  
  //     const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '');
  //     const fileName = `${emailID}/submission_${timestamp}.zip`;
  
  //     const result = await storage.bucket(bucketName).file(fileName).save(releaseData);
  
  //     return {
  //       statusCode: 200,
  //       msg: `Successfully uploaded the file to GCS Bucket: ${bucketName}/${fileName}. Your submission url is: ${submission_url}`,
  //     };
  //   } catch (error) {
  //     console.error('Error:', error);
  
  //     return {
  //       statusCode: 500,
  //       msg: `Unable to upload the file due to the following error: ${error}. Your submission url is: ${submission_url}`,
  //     };
  //   }
  // }

  //const senderEmailId = 'bandaru.si@northeastern.edu'
  export async function sendEmail(to, subject, message) {
    try {
      await mg.messages.create(mailgunDomain, {
        from: user_id,
        to: [to],
        subject: subject,
        text: message,
      })
      return {
        statusCode: 200,
        body: 'Success',
      };
    }
      catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: 'Failed' };
      }
  }
    
    // try {
    //   const mailOptions = {
    //     from: user_id,
    //     to: to,
    //     subject: subject,
    //     text: message,
    //   };
    //   const result = await transporter.sendMail(mailOptions);
    //   console.log(result);
    //   return {
    //     statusCode: 200,
    //     body: 'Success',
    //   };
    // }
    //   catch (error) {
    //     console.error('Error:', error);
    //     return { statusCode: 500, body: 'Failed' };
    //   }
  
  
  export async function trackEmail(user_email, subject, submission_url, status_msg,context) {
    try {
      const params = {
        TableName: process.env.DYNAMO_DB_TABLE,
        Item: {
          id: context.awsRequestId, // Use Lambda request ID as a unique identifier
          subscriptionurl: submission_url,
          sender: user_id,
          recipient: user_email,
          subject: subject,
          sentAt: new Date().toISOString(),
          email_status: status_msg,
        },
      };
      const result = await dynamoDB.put(params).promise();
      console.log(result)
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Updated email status in Dynamodb' }),
      };
    } catch (error) {
      console.error('Error:', error);
      return { statusCode: 500, body: `Internal Server Error: ${error}` };
    }
  }


