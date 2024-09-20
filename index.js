const express = require('express');
const axios = require('axios');
const cors = require('cors');
const util = require('./utility');

const app = express();
const port = 3000;

// Global variables to store token, employeeID, and displayName
let globalToken = '';
let globalemployeeID = '';
let globalDisplayName = '';

// Session activity tracker
const sessionActivity = {};

// Set a timeout limit (in milliseconds) for user inactivity (5 minutes)
const sessionTimeoutLimit = 5 * 60 * 1000; // 5 minutes

// Enable CORS for all routes
app.use(cors());

// Parse incoming JSON data
app.use(express.json());

app.use((req, res, next) => {
  const session = req.body.sessionInfo ? req.body.sessionInfo.session : null;

  if (session) {
    sessionActivity[session] = Date.now(); // Update the session activity timestamp
  }
  next();
});

// Function to check for session timeouts and restart inactive sessions
setInterval(() => {
  const currentTime = Date.now();
  
  Object.keys(sessionActivity).forEach(session => {
    if (currentTime - sessionActivity[session] > sessionTimeoutLimit) {
      // If the session has been inactive for more than the timeout limit, reset it
      console.log(`Session ${session} has been inactive for over 5 minutes. Restarting session.`);

      // You can send a response to Dialogflow to restart the session here if needed
      const dialogflowResponse = util.formatResponseForDialogflow(
        ["It seems you've been inactive for a while. Let's start over!"], 
        { session: session, parameters: {} },
        "", // No targetFlow
        ""  // No targetPage
      );

      // Assuming you have a method to send this to Dialogflow or log it
      console.log("Session restarted:", session);

      // Reset session activity
      delete sessionActivity[session];
    }
  });
}, 60 * 1000); 

// Login API endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { employeeID, lanId, password, emailAddress } = req.body;

    let data = JSON.stringify({
      "employeeID": employeeID,
      "lanId": lanId,
      "password": password,
      "emailAddress": emailAddress || "string"
    });

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://demo.techmbs.in/GrievanceToolAPI/api/Authorize/Login',
      headers: { 
        'Content-Type': 'application/json'
      },
      data: data
    };

    // Send request to the external API
    const apiResponse = await axios.request(config);

    const {
      token, refreshToken, userRole, email, username, displayName, responseCode, result, message
    } = apiResponse.data;

    // Log captured data
    console.log('Captured Data:', { token, refreshToken, userRole, email, username, globalemployeeID, displayName, responseCode, result, message });

    // Store the token, employeeID, and displayName in global variables
    globalToken = token;
    globalemployeeID = employeeID; 
    globalDisplayName = displayName;

    // Send the response back to the client
    res.status(200).json({ token, refreshToken, userRole, email, username, globalemployeeID, displayName, responseCode, result, message });

    console.log("Stored token: ", token);
    console.log("Stored employeeID: ", employeeID);
    console.log("Stored displayName: ", displayName);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      message: 'An error occurred while trying to log in',
      error: error.message
    });
  }
});

// Dialogflow CX Webhook
app.post('/webhook', async (req, res) => {
  try {
    const tag = req.body.fulfillmentInfo.tag;
    console.log("Webhook tag details: " + tag);

    // Check if the Dialogflow CX webhook tag is "Login"
    if (tag === 'Login') {
      // Retrieve the session and parameters
      const session = req.body.sessionInfo.session;
      const parameters = req.body.sessionInfo.parameters || {}; 

      console.log("Retrieved parameters:", parameters);

      // Add globalDisplayName to parameters
      parameters.displayName = globalDisplayName;

      // Format response for Dialogflow
      const dialogflowResponse = util.formatResponseForDialogflow(
        [``],
        { session, parameters },
        "", // No targetFlow
        ""  // No targetPage
      );

      // Send the formatted response to Dialogflow
      res.status(200).send(dialogflowResponse);
      console.log("Sent displayName to Dialogflow:", globalDisplayName);

    } else if (tag === 'ticket') {
      // Retrieve parameters from the Dialogflow request
      var ticketID = req.body.sessionInfo.parameters.ticketid;
      const parameters = req.body.sessionInfo.parameters || {};
      
      // Fetch employeeId and grievanceId from parameters
      const grievanceId = parameters.grievanceId || "";
      
      // Use the global employee ID
      const employeeId = globalemployeeID;
      
      // Check if employeeId exists
      if (!employeeId) {
          return res.status(400).send(util.formatResponseForDialogflow(
              ['Employee ID is required to fetch grievance details.'],
              { session: req.body.sessionInfo.session, parameters },
              "",
              ""
          ));
      }
      
      let data = JSON.stringify({
          "employeeId": employeeId,
          "grievanceId": grievanceId
      });
      
      let config = {
          method: 'post',
          maxBodyLength: Infinity,
          url: 'https://demo.techmbs.in/GrievanceToolAPI/api/Grievance/getGrievanceDetailsByEmployeeId',
          headers: { 
              'Authorization': `Bearer ${globalToken}`,
              'Content-Type': 'application/json'
          },
          data: data
      };
      
      // Send request to the grievance details API
      const apiResponse = await axios.request(config);
      const grievanceDetails = apiResponse.data;
      
      // Log grievance details
      console.log('Grievance Details:', grievanceDetails);
  
      // Calculate the number of grievances raised
      const ticketCount = grievanceDetails.length;
      console.log(`Total number of grievance tickets: ${ticketCount}`);
      
      // Initialize an object to store the formatted grievance details
      let formattedGrievances = {};
  
      // Save each ticket details into individual variables
      grievanceDetails.forEach((grievance, index) => {
          const suffix = index === 0 ? '' : index;
  
          formattedGrievances[`grievanceId${suffix}`] = grievance.grievanceId;
      });
  
      // Include the ticket count in the parameters
      formattedGrievances.ticketCount = ticketCount;
  
      // Format the response for Dialogflow, including the ticket count
      const dialogflowResponse = util.formatResponseForDialogflow(
          [``],
          {
              session: req.body.sessionInfo.session,
              parameters: formattedGrievances 
          },
          "", // No targetFlow
          ""  // No targetPage
      );
  
      // Send the formatted response to Dialogflow
      res.status(200).send(dialogflowResponse);
      console.log("Sent formatted grievance details and ticket count to Dialogflow:", formattedGrievances);
    
    } else if (tag === 'GrevID') {
      const parameters = req.body.sessionInfo.parameters || {};
      console.log("Received parameters:", parameters);

      const grievanceId = parameters.griv_id;
      const employeeId = globalemployeeID;

      if (!employeeId || !grievanceId) {
        return res.status(400).send(util.formatResponseForDialogflow(
          [],
          { session: req.body.sessionInfo.session, parameters },
          "",
          ""
        ));
      }

      let data = JSON.stringify({
        "employeeId": employeeId,
        "grievanceId": grievanceId
      });

      let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://demo.techmbs.in/GrievanceToolAPI/api/Grievance/getGrievanceDetailsByEmployeeId',
        headers: { 
          'Authorization': `Bearer ${globalToken}`,
          'Content-Type': 'application/json'
        },
        data: data
      };

      try {
        const apiResponse = await axios.request(config);
        const grievanceDetails = apiResponse.data;
        console.log('Grievance Details:', grievanceDetails);

        const formattedGrievance = grievanceDetails.map(grievance => ({
          grievanceId: grievance.grievanceId,
          employeeName: grievance.employeeName.trim(),
          leve1_Name: grievance.leve1_Name.trim(),
          leve2_Name: grievance.leve2_Name.trim(),
          leve3_Name: grievance.leve3_Name.trim(),
          category: grievance.category,
          subcategory: grievance.subcategory,
          status: grievance.status,
          isAcknowledge: grievance.isAcknowledge,
          acknowledgeOn: grievance.acknowledgeOn,
          closedOn: grievance.closedOn,
          currentLevel: grievance.currentLevel,
          complianceStatus: grievance.complianceStatus
        }))[0];

        const responseParameters = {
          grievanceId: formattedGrievance.grievanceId,
          employeeName: formattedGrievance.employeeName,
          leve1_Name: formattedGrievance.leve1_Name,
          leve2_Name: formattedGrievance.leve2_Name,
          leve3_Name: formattedGrievance.leve3_Name,
          category: formattedGrievance.category,
          subcategory: formattedGrievance.subcategory,
          status: formattedGrievance.status,
          isAcknowledge: formattedGrievance.isAcknowledge,
          acknowledgeOn: formattedGrievance.acknowledgeOn,
          closedOn: formattedGrievance.closedOn,
          currentLevel: formattedGrievance.currentLevel,
          complianceStatus: formattedGrievance.complianceStatus,
        };

        const dialogflowResponse = util.formatResponseForDialogflow(
          [],
          {
            session: req.body.sessionInfo.session,
            parameters: responseParameters
          },
          "", // No targetFlow
          ""  // No targetPage
        );

        res.status(200).send(dialogflowResponse);
        console.log("Sent formatted grievance details to Dialogflow:", responseParameters);

      } catch (error) {
        console.error('Error fetching grievance details:', error.message);

        if (error.response) {
          console.log("Error response data:", error.response.data);
          console.log("Error status:", error.response.status);

          if (error.response.status === 404) {
            console.log("404 error encountered, setting session parameter ID_not_found");

            const dialogflowResponse = util.formatResponseForDialogflow(
              [],
              {
                session: req.body.sessionInfo.session,
                parameters: {
                  ...req.body.sessionInfo.parameters,
                  ID_not_found: "ID_not_found"  // Set session parameter here
                }
              },
              "", // No targetFlow
              ""  // No targetPage
            );
            return res.status(200).send(dialogflowResponse);
          }
        } else {
          console.log("No response from server");
        }

        return res.status(500).json({
          fulfillmentResponse: {
            messages: [{ text: { text: ['An error occurred while processing the request.'] } }]
          }
        });
      }
    } else {
      res.status(400).json({ error: 'Unknown tag' });
    }
  } catch (error) {
    console.error('Error handling webhook request:', error.message);
    res.status(500).json({
      fulfillmentResponse: {
        messages: [{ text: { text: ['An internal server error occurred.'] } }]
      }
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});