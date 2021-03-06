import React, { Component, useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom';
import { init, locations } from 'contentful-ui-extensions-sdk';
import Heading from '@contentful/forma-36-react-components/dist/components/Typography/Heading';
import Note from '@contentful/forma-36-react-components/dist/components/Note';
import Form from '@contentful/forma-36-react-components/dist/components/Form';
import TextField from '@contentful/forma-36-react-components/dist/components/TextField';
import Textarea from '@contentful/forma-36-react-components/dist/components/Textarea';
import Button from '@contentful/forma-36-react-components/dist/components/Button';

import '@contentful/forma-36-react-components/dist/styles.css';
import '@contentful/forma-36-fcss/dist/styles.css';
import './css/global.css';

init(sdk => {
  const Component = sdk.location.is(locations.LOCATION_APP_CONFIG) ? Config : ObjectField;

  ReactDOM.render(<Component sdk={sdk} />, document.getElementById('root'));

  if (sdk.window) {
    sdk.window.startAutoResizer();
  }
});

class Config extends Component {
  constructor (props) {
    super(props);
    this.state = { parameters: {} };
    this.app = this.props.sdk.app;
    this.app.onConfigure(() => this.onConfigure());
  }

  async componentDidMount () {
    const parameters = await this.app.getParameters();
    this.setState(
      { parameters: parameters || {} },
      () => this.app.setReady()
    );
  }

  render () {
    return (
      <Form id="app-config">
        <Heading>OMDB Configuration</Heading>
        <Note noteType="primary" title="About the app">
          Enter your OMDB API key.
        </Note>
        <label forHtml="omdb-api-key">OMDb API Key</label>
        <TextField
          required
          name="omdb-api-key"
          id="omdb-api-key"
          label="OMDb API Key"
          value={this.state.parameters.omdbApiKey || null}
          onChange={e => this.setState({ parameters: { omdbApiKey: e.target.value } })}
        />
      </Form>
    );
  }

  async onConfigure () {
    return {
      parameters: this.state.parameters
    };
  }
}

Config.propTypes = {
  sdk: PropTypes.object
};

function ObjectField ({ sdk }) {
  const [buttonLoadingValue, buttonSetLoading] = useState(false);
  const [omdbValue, omdbSetState] = useState(sdk.field.getValue());
  const [imdbFieldValue, imdbSetState] = useState(sdk.entry.fields['imdb'].getValue());
  const omdbField = sdk.field;
  const imdbField = sdk.entry.fields['imdb'];
  const inputEl = useRef();

  useEffect(() => {
    const imdbValueChanged = imdbField.onValueChanged(value => {
      imdbSetState(value);
    });

    return imdbValueChanged;
  });

  useEffect(() => {
    updateOmdbField(imdbFieldValue);
  }, [imdbFieldValue, updateOmdbField])

  useEffect(() => {
    const omdbValueChanged = omdbField.onValueChanged(value => {
      omdbSetState(value);
    });

    return omdbValueChanged;
  });

  const validateAndSave = debounce((data) => {
    omdbSetState(data);
    if (!data) {
      sdk.field.setInvalid(false);
      sdk.field.removeValue();
    } else if (isValidJson(data)) {
      const val = typeof data === 'string' ? JSON.parse(data) : data;
      sdk.field.setInvalid(false);
      sdk.field.setValue(val);
      // Update other fields with OMDB data.
      updateEntry(val);
    } else {
      sdk.field.setInvalid(true)
    }
  }, 150);

  const updateOmdbField = useCallback(async (imdbValue) => {
    if (!imdbValue) {
      return;
    }
    const apiKey = sdk.parameters.installation.omdbApiKey || null;
    const matches = imdbValue.match(/imdb\.com\/title\/(tt[^/]*)/);
    if (matches) {
      const data = await getMovie(apiKey, matches[1]);
      if (typeof data === 'object' && data.Response.toLowerCase() === 'true') {
        validateAndSave(data);
      } else {
        sdk.notifier.error(`Error fetching data. ${data.Error || ''}`);
      }
    }

    return;
  }, [validateAndSave, sdk.parameters.installation.omdbApiKey, sdk.notifier]);

  async function updateEntry(omdbData) {
    sdk.entry.fields['title'].setValue(omdbData.Title);
    let genreLinks = [];
    const omdbGenres = omdbData.Genre.split(', ').filter(genre => genre !== 'N/A');
    if (omdbGenres.length > 0) {
      const genreEntries = await sdk.space.getEntries({
        'content_type': 'genre',
        'fields.name[in]': omdbGenres
      });

      if (genreEntries.total === omdbGenres.length) {
        genreLinks = genreEntries.items.sort((a, b) => {
          return omdbGenres.indexOf(a.fields.name[sdk.field.locale]) - omdbGenres.indexOf(b.fields.name[sdk.field.locale]);
        });
      } else {
        for await (const genre of omdbGenres) {
          let genreEntry = genreEntries.items.find(element => element.fields.name[sdk.field.locale] === genre);
          if (!genreEntry) {
            genreEntry = await sdk.space.createEntry('genre', {
              fields: {
                name: {
                  [sdk.field.locale]: genre
                }
              }
            });
          }

          genreLinks.push(genreEntry)
        }
      }

      const genreValue = genreLinks.map(link => ({
        sys: {
          type: 'Link',
          linkType: link.sys.type,
          id: link.sys.id,
        }
      }));

      sdk.entry.fields['genre'].setValue(genreValue);
    }
  }

  return (
    <>
      <Textarea
        name="omdbData"
        id="omdbData"
        value={omdbValue ? JSON.stringify(omdbValue) : ''}
        readOnly={true}
        onChange={e => validateAndSave(e.target.value)}
        textareaRef={inputEl}
      />
      <Button
        buttonType="primary"
        onClick={async () => {
          const imdbUrl = sdk.entry.fields['imdb'].getValue();
          buttonSetLoading(true);
          await updateOmdbField(imdbUrl);
          buttonSetLoading(false);
        }}
        disabled={buttonLoadingValue}
        loading={buttonLoadingValue}
      >
        Fetch Movie
      </Button>
      <Button
        buttonType="negative"
        onClick={() => {
          sdk.field.removeValue();
        }}
      >
        Clear Field
      </Button>
    </>
  )
}

ObjectField.propTypes = {
  sdk: PropTypes.object
};

async function getMovie(apiKey, imdbId) {
  if (apiKey && imdbId) {
    try {
      const response = await fetch(`https://www.omdbapi.com/?apikey=${apiKey}&i=${imdbId}`);
      const data = await response.json();
      return data;
    } catch (error) {
      return error;
    }
  }
}

// http://davidwalsh.name/javascript-debounce-function
const debounce = (func, wait, immediate) => {
   let timeout;
   return function() {
     const context = this, args = arguments;
     const later = function() {
       timeout = null;
       if (!immediate) func.apply(context, args);
     };
     const callNow = immediate && !timeout;
     clearTimeout(timeout);
     timeout = setTimeout(later, wait);
     if (callNow) func.apply(context, args);
   };
};

const isValidJson = str => {
  // An object or array is valid JSON
  if (typeof str === 'object') {
     return true;
  }

  try {
     JSON.parse(str)
  } catch (e) {
     return false;
  }

  return true;
};
