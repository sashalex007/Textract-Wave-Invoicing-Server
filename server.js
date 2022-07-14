import fs from 'fs'
import path from 'path'
import { PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, StartDocumentAnalysisCommand, GetDocumentAnalysisCommand } from '@aws-sdk/client-textract';
import { TextractDocument } from "amazon-textract-response-parser";
import fetch from 'node-fetch';
import { customers } from './customers.js'
import { products } from './products.js'

//YOU MUST FIRST INSTALL AWS CLI AND CONFIGURE ACCESS KEYS BEFORE RUNNING THIS SERVER. https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html#getting-started-install-instructions
//YOU ALSO NEED AN EXISTING WAVEAPPS ACCOUNT

const waveAccessToken = 'XXXXX' //create a new wave app and get your access token https://developer.waveapps.com/hc/en-us/sections/360003012132-Create-an-App
const waveBusinessID = 'XXXXX' //run 'node server.js' to get your business ID (ONLY AFTER FILLING IN YOUR waveAccessToken)
const S3bucket = "invoicebucket" // Create an S3 bucket named invoicebucket in the AWS console


let fileArray = []
let processedFileCount = 0
const bucketFolder = '/Users/alexandrepokhodoun/Desktop/PO\ BUCKET'; //replace with path to folder that will contain purchase orders
const downloadFolder = '/Users/alexandrepokhodoun/Desktop/INVOICES'; //completed invoices downloaded to this folder
fs.readdir(bucketFolder, (err, files) => {
  files.forEach(file => {
    if (file != '.DS_Store') {
      let uploadObject = {}
      uploadObject.path = bucketFolder + "/" + file
      uploadObject.originalname = file
      fileArray.push(uploadObject)
    }
  });
  deleteFilesInDumpFolder(downloadFolder)

  ////START HERE
  getBusiness() // Delete this line once you have your waveBusinessID 

  //getData() //UNCOMMENT TO GENERATE PRODUCT AND CUSTOMER FILES. Run 'node server.js' and delete this line.
  
  //processInvoice(fileArray[processedFileCount]) //UNCOMMENT TO BUILD YOUR PARSER WITH A SAMPLE DOCUMENT
});


async function processInvoice(file) {

  console.log('\n')
  console.log("Uploading " + file.originalname)

  await uploadToS3(file)
  console.log("File uploaded to S3 bucket")

  let jobID = await readFileWithTextract(file.originalname)
  console.log("AWS Textract job created")

  let textractResult = await waitUntilSuccess(jobID.JobId)

  await deleteS3file(file)
  console.log("File deleted from S3 bucket")

  console.log(textractResult)
  
  // let invoiceData = parseTextractData(textractResult) //UNCOMMENT THIS LINE TO BUILD OUT PARSER

  // let invoiceURL = await createInvoice(invoiceData) //UNCOMMENT FROM HERE DOWN ONCE PARSER IS BUILT
  // let downloadResult = await downloadInvoice(invoiceURL, downloadFolder)
  // console.log(downloadResult)

  // if (processedFileCount < fileArray.length) {
  //   processInvoice(fileArray[processedFileCount])
  // } else {
  //   console.log('\n')
  //   console.log('DONE')
  //   return
  // }


  async function uploadToS3(file) {
    const s3 = new S3Client({ region: process.env.AWS_REGION });

    const fileContent = fs.readFileSync(file.path);

    const params = {
      Bucket: S3bucket, // Create bucket in S3 with AWS console
      Key: file.originalname,
      Body: fileContent,
    };

    try {
      await s3.send(new PutObjectCommand(params))
      return file.originalname

    } catch (err) {
      console.log('ERROR', err);
      return err;
    }
  };

  async function readFileWithTextract(fileName) {

    const textract = new TextractClient({ region: process.env.AWS_REGION });

    const params = {
      DocumentLocation: {
        S3Object: {
          Bucket: S3bucket, // This will be the same bucket that you use to save the file
          Name: fileName,
        },
      },
      //FeatureTypes: ['TABLES', 'FORMS']
      FeatureTypes: ['TABLES']

    };

    const command = new StartDocumentAnalysisCommand(params);

    try {
      let request = await textract.send(command)
      return request
    } catch (err) {
      // Handle error
      console.log('ERROR', err);
      return err;
    }
  };

  async function getOnejob(JobId, NextToken) {
    const textract = new TextractClient({ region: process.env.AWS_REGION });

    const params = { JobId };

    if (NextToken) params.NextToken = NextToken;

    const command = new GetDocumentAnalysisCommand(params);

    try {
      let request = await textract.send(command)
      return request
    } catch (err) {
      // Handle error
      console.log('ERR', err);
      return err;
    }
  }

  async function waitUntilSuccess(jobid) {
    return await new Promise(resolve => {
      const interval = setInterval(async function () {
        let result = await getOnejob(jobid, null)
        if (result.JobStatus === "SUCCEEDED") {
          resolve(result);
          clearInterval(interval);
        }
        console.log(result.JobStatus)
      }, 1000);
    });
  }

  function parseTextractData(result) {
    let invoiceObject = {}
    const doc = new TextractDocument(result);
    const page = doc.pageNumber(1);
    const table = page.tableAtIndex(0);

    //Parse textract data here. Invoices require a customer name, customer ID (use customers.js) and item(s) ID (use products.js).
    // refer to https://github.com/aws-samples/amazon-textract-response-parser/blob/master/src-js/README.md
   
    invoiceObject.items = [{productId: 'product ID', quantity: 'product quantity'}] //put each product object in this array 
    invoiceObject.name = 'customer name'
    invoiceObject.id = 'customer id'
    invoiceObject.poNumber = "PO number" //optional

    return invoiceObject
  }

  async function createInvoice(invoiceData) {
    let input = {
      "businessId": waveBusinessID,
      "customerId": invoiceData.id,
      "poNumber": invoiceData.poNumber,
      "items": invoiceData.items
    }

    let mutation = `mutation ($input: InvoiceCreateInput!) {
      invoiceCreate(input: $input) {
        didSucceed
        inputErrors {
          message
          code
          path
        }
        invoice {
          id
          createdAt
          modifiedAt
          pdfUrl
          viewUrl
          status
          title
          subhead
          invoiceNumber
          invoiceDate
          poNumber
          customer {
            id
            name
            # Can add additional customer fields here
          }
          currency {
            code
          }
          dueDate
          amountDue {
            value
            currency {
              symbol
            }
          }
          amountPaid {
            value
            currency {
              symbol
            }
          }
          taxTotal {
            value
            currency {
              symbol
            }
          }
          total {
            value
            currency {
              symbol
            }
          }
          exchangeRate
          footer
          memo
          disableCreditCardPayments
          disableBankPayments
          itemTitle
          unitTitle
          priceTitle
          amountTitle
          hideName
          hideDescription
          hideUnit
          hidePrice
          hideAmount
          items {
            product {
              id
              name
              # Can add additional product fields here
            }
            description
            quantity
            price
            subtotal {
              value
              currency {
                symbol
              }
            }
            total {
              value
              currency {
                symbol
              }
            }
            account {
              id
              name
              subtype {
                name
                value
              }
              # Can add additional account fields here
            }
            taxes {
              amount {
                value
              }
              salesTax {
                id
                name
                # Can add additional sales tax fields here
              }
            }
          }
          lastSentAt
          lastSentVia
          lastViewedAt
        }
      }
    }`

    const invoiceURL = await fetch('https://gql.waveapps.com/graphql/public', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + waveAccessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: { input }
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data.data.invoiceCreate.didSucceed) {
          processedFileCount++
          console.log("Invoice Created " + (processedFileCount) + "/" + fileArray.length)
          return data.data.invoiceCreate.invoice.pdfUrl
        }
      });

    return invoiceURL

  }

  async function downloadInvoice(url, path) {
    const res = await fetch(url);
    return await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(path + "/" + processedFileCount + ".pdf");
      res.body.pipe(fileStream);
      res.body.on("error", (err) => {
        reject(err);
      });
      fileStream.on("finish", function () {
        resolve('Invoice PDF downloaded');
      });
    });
  }

  async function deleteS3file(file) {
    const s3 = new S3Client({ region: process.env.AWS_REGION });

    const params = {
      Bucket: S3bucket, 
      Key: file.originalname,
    };

    try {
      await s3.send(new DeleteObjectCommand(params))
      return file.originalname

    } catch (err) {
      console.log('ERROR', err);
      return err;
    }
  };

}

function deleteFilesInDumpFolder(directory) {
  fs.readdir(directory, (err, files) => {
    if (err) throw err;

    for (const file of files) {
      fs.unlink(path.join(directory, file), err => {
        if (err) throw err;
      });
    }
  });
}

async function getData() {
  const id = waveBusinessID
  let queryCustomers = `query ($id: ID!) {
    business(id: $id) {
      customers(page: 1, pageSize: 100, sort: [NAME_ASC]) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }`

  let queryProducts = `query ($id: ID!) {
    business(id: $id) {
      products(page: 1, pageSize: 100) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }`

  let customerData = await fetchData(id, queryCustomers)
  let productData = await fetchData(id, queryProducts)
  sortCustomers(customerData) //sort and write to file
  sortProducts(productData)
  console.log('Done')

  async function fetchData(id, query) {
    let waveData = await fetch('https://gql.waveapps.com/graphql/public', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + waveAccessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query,
        variables: { id }
      })
    })
      .then(r => r.json())
      .then(data => {
        return data
      });

    return waveData
  }

  function sortCustomers(data) {
    let customersObject = {}
    let i = 0
    for (let customer of data.data.business.customers.edges) {
      customersObject[i] = {
        name: customer.node.name,
        id: customer.node.id
      }
      i++
    }
    writeToFile('customers', customersObject)
  }

  function sortProducts(data) {
    let productsObject = {}
    let i = 0
    for (let product of data.data.business.products.edges) {
      productsObject[i] = {
        name: product.node.name,
        id: product.node.id
      }
      i++
    }
    writeToFile('products', productsObject)
  }

  function writeToFile(filename, data) {
    let fileString = "export const " + filename + " = " + JSON.stringify(data, null, 2)
    fs.writeFile(filename + '.js', fileString, function (err) {
      if (err) return console.log(err);
    });
  }

}

async function getBusiness() {

  let queryBusiness = `query {
    businesses(page: 1, pageSize: 10) {
      pageInfo {
        currentPage
        totalPages
        totalCount
      }
      edges {
        node {
          id
          name
          isClassicAccounting
          isClassicInvoicing
          isPersonal
        }
      }
    }
  }`

  let businessData = await fetchData(queryBusiness)
  console.log(businessData.data.businesses.edges)

  async function fetchData(query) {
    let waveData = await fetch('https://gql.waveapps.com/graphql/public', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + waveAccessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query,
      })
    })
      .then(r => r.json())
      .then(data => {
        return data
      });

    return waveData
  }
}


