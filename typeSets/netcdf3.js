// javascript implementation of netcdf3 format described here:
// http://www.unidata.ucar.edu/software/netcdf/docs/netcdf/File-Format-Specification.html

/*!
 * The MIT License (MIT)
 * Copyright © 2013 Jonathan Beezley, jon.beezley@gmail.com
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the “Software”), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// The file read method returns an object with the following structure, which
// is largely compatible with the netCDF4 python module where possible.
/*
File object:
{
    // classic or 64 bit format
    version: "classic" | "64bitOffset",

    // number of record dimensions
    numrecs: <uint32>,

    // dimension mapping
    dimensions: { <string> : <uint32>, ... },

    // global attribute mapping
    attributes: { <string> : <attrType>, ... },

    // variable mapping
    variables: { <string> : <varType>, ... }
}

attrType:
{
    // jBinary data type
    dtype : <string>,

    // number of elements of the attribute
    // -or- number of characters in the string
    length: <uint32>,

    // array of values of the attribute
    // -or- the value of the attribute if length == 1
    // -or- a string representing a character array attribute
    value: <dtype>[length] | <dtype> | <string>
}

varType:
{
    // array of dimension names describing the variables shape
    dimensions: [ <string>, ... ],

    // variable attribute mapping
    attributes: { <string> : <attrType> },

    // jBinary data type
    dtype: <string>,

    // function to inquire the shape of the variable
    shape: function () { return [<uint32>, ... ]; }
}
*/
//*** Other methods and variables exist, but should be considered "private"
//*** from the user's perspective.
//
//*** Write support is untested and in development... 


define(['jbinary'], function (jBinary) {
    'use strict';

    // Constants defined by the netcdf specification:
    var ABSENT       = 0,
        NC_BYTE      = 1,
        NC_CHAR      = 2,
        NC_SHORT     = 3,
        NC_INT       = 4,
        NC_FLOAT     = 5,
        NC_DOUBLE    = 6,
        NC_DIMENSION = 10,
        NC_VARIABLE  = 11,
        NC_ATTRIBUTE = 12,
        typeMap = {},
        invTypeMap = {},
        typekey;

    // type mapping from netcdf definition to jbinary types
    typeMap[NC_BYTE]   = 'int8';
    typeMap[NC_CHAR]   = 'char';
    typeMap[NC_SHORT]  = 'int16';
    typeMap[NC_INT]    = 'int32';
    typeMap[NC_FLOAT]  = 'float32';
    typeMap[NC_DOUBLE] = 'float64';

    // inverse mapping of the above
    for (typekey in typeMap) {
        if (typeMap.hasOwnProperty(typekey)) {
            invTypeMap[typeMap[typekey]] = (+typekey);
        }
    }

    return {
        'jBinary.all': 'Header',
        'jBinary.mimeType': 'application/x-netcdf',
        'jBinary.littleEndian': false,

        // Custom types

        // Padding to 4 byte boundaries
        Padding: ['skip', function () {
            return (4 - (this.binary.tell() % 4)) % 4;
        }],

        // String type format [uint32 length, char value[length], Padding]
        NcString: jBinary.Type({
            read: function () {
                var length, value;
                length = this.binary.read('uint32');
                value = this.binary.read(['string', length]);
                this.binary.read('Padding');
                return value;
            },
            write: function (data) {
                this.binary.write('uint32', data.length);
                this.binary.write(['string', data.length], data);
                this.binary.write('Padding');
            }
        }),

        // dimension type
        // format: [NcString name, uint32 length]
        DimType: {
            name: 'NcString',
            length: 'uint32'
        },

        // dimension array
        // format: [uint32 0 | 10, uint32 length, DimType dims[length]]
        DimArray: jBinary.Type({
            read: function () {
                var _check, length, dims, dim, name, dimorder, i;
                _check = this.binary.read('uint32');
                length = this.binary.read('uint32');
                if (_check !== NC_DIMENSION && _check !== ABSENT) {
                    throw new TypeError("Invalid dimension array.");
                }
                dims = {};
                dimorder = []; // we need to store the order of dimensions
                for (i = 0; i < length; i += 1) {
                    dim = this.binary.read('DimType');
                    name = dim.name;
                    dimorder[i] = name;
                    dims[name] = dim.length;
                }
                dims._getIDim = function (iDim) { return dimorder[iDim]; };
                dims._getIndex = function (name) { return dimorder.indexOf(name); };
                return dims;
            },
            write: function (data) {
                var name, i, length, dim;
                if (data.length === 0) {
                    this.binary.write('uint32', ABSENT);
                    this.binary.write('uint32', 0);
                } else {
                    this.binary.write('uint32', NC_DIMENSION);
                    this.binary.write('uint32', data.length);
                    for (i = 0; i < data.length; i += 1) {
                        name = data._getIDim(i);
                        length = data[name];
                        dim = {
                            length: length,
                            name: name
                        };
                        this.binary.write('DimType', dim);
                    }
                }
            }
        }),

        // data type mapping from netcdf specification
        DataType: jBinary.Type({
            read: function () {
                var rtype, xtype;
                rtype = this.binary.read('uint32');
                xtype = typeMap[rtype];
                if (typeof xtype !== 'string') {
                    throw new TypeError("Invalid data type.");
                }
                return xtype;
            },
            write: function (data) {
                var xtype = invTypeMap[data];
                if (typeof xtype !== 'number') {
                    throw new TypeError("Invalid data type.");
                }
                this.binary.write('uint32', xtype);
            }
        }),

        // attribute type
        // format: [NcString name, Datatype dtype, uint32 length, dtype values[length]]
        AttrType: jBinary.Type({
            read: function () {
                var name, dtype, length, value;
                name = this.binary.read('NcString');
                dtype = this.binary.read('DataType');
                length = this.binary.read('uint32');
                value = this.binary.read(['array', dtype, length]);
                if (dtype === 'char') {
                    value = value.join('');  // turn character array into a string
                } else if (length === 1) {
                    value = value[0]; // turn array of length 1 into a single value
                }
                this.binary.read('Padding');
                return {
                    name: name,
                    dtype: dtype,
                    length: length,
                    value: value
                };
            },
            write: function (data) {
                this.binary.write('NcString', data.name);
                this.binary.write('DataType', data.dtype);
                this.binary.write('uint32', data.length);
                if (data.length === 1) {
                    this.binary.write(data.dtype, data.value);
                } else {
                    this.binary.write(['array', data.dtype, data.length], data.value);
                }
                this.binary.write('Padding');
            }
        }),

        // attribute array
        // format: [uint32 0 | 12, uint32 length, AttrType attrs[length]]
        AttrArray: jBinary.Type({
            read: function () {
                var _check, length, attrs, attr, name, i;
                _check = this.binary.read('uint32');
                length = this.binary.read('uint32');
                if (_check !== NC_ATTRIBUTE && _check !== ABSENT) {
                    throw new TypeError("Invalid attribute array.");
                }
                attrs = {};
                for (i = 0; i < length; i += 1) {
                    attr = this.binary.read('AttrType');
                    name = attr.name;
                    delete attr.name;
                    attrs[name] = attr;
                }
                return attrs;
            },
            write: function (data) {
                var name, attr, key, length = 0;
                for (key in data) {
                    if (data.hasOwnProperty(key)) {
                        length += 1;
                    }
                }
                if (length === 0) {
                    this.binary.write('uint32', ABSENT);
                    this.binary.write('uint32', 0);
                } else {
                    this.binary.write('uint32', NC_ATTRIBUTE);
                    this.binary.write('uint32', length);
                    for (name in data) {
                        if (data.hasOwnProperty(name)) {
                            attr = data[name];
                            attr.name = name;
                            this.binary.write('AttrType', attr);
                            delete attr.name;
                        }
                    }
                }
            }
        }),

        OffSetType: jBinary.Type({
            read: function (context) {
                var offset;
                if (context.version === 'classic') {
                    offset = this.binary.read('uint32');
                } else if (context.version === '64bitOffset') {
                    offset = this.binary.read('uint64');
                } else {
                    throw new TypeError("Invalid file version.");
                }
                return offset;

            },
            write: function (data, context) {
                if (context.version === 'classic') {
                    this.binary.write('uint32', data);
                } else if (context.version === '64bitOffset') {
                    this.binary.write('uint64', data);
                } else {
                    throw new TypeError("Invalid file version.");
                }
            }
        }),

        // variable type
        // format: [NcString name, uint32 nDims, uint32 dimids[nDims], 
        //          AttrArray attrs, DataType xtype, uint32 vsize,
        //          OffSetType offset]
        VarType: jBinary.Type({
            read: function (context) {
                var name, nDims, dimid, attrs, xtype, vsize, offset, dims, shape, i;
                name = this.binary.read('NcString');
                nDims = this.binary.read('uint32');
                dims = [];
                for (i = 0; i < nDims; i += 1) {
                    dimid = this.binary.read('uint32');
                    dims[i] = context.dimensions._getIDim(dimid);
                }
                attrs = this.binary.read('AttrArray');
                xtype = this.binary.read('DataType');
                vsize = this.binary.read('uint32');
                offset = this.binary.read('OffSetType');
                shape = function () {
                    var n = [];
                    for (i = 0; i < dims.length; i += 1) {
                        n[i] = context.dims[dims[i]];
                    }
                    if (n[0] === 0) {
                        n[0] = context.numrecs;
                    }
                    return n;
                };
                return {
                    name: name,
                    dimensions: dims,
                    attributes: attrs,
                    dtype: xtype,
                    _vsize: vsize,
                    _offset: offset,
                    shape: shape
                };
            },
            write: function (data, context) {
                var i;
                this.binary.write('NcString', data.name);
                this.binary.write('uint32', data.dimensions.length);
                for (i = 0; i < data.dimensions.length; i += 1) {
                    this.binary.write('uint32', context.diminsions._getIndex(data.dimensions[i]));
                }
                this.binary.write('AttrArray', data.attributes);
                this.binary.write('DataType', data.dtype);
                this.binary.write('uint32', data._vsize);
                this.binary.write('OffSetType', data._offset);
            }
        }),

        // variable array
        // format: [uint32 0 | 11, uint32 length, VarType vars[length]]
        VarArray: jBinary.Type({
            read: function () {
                var _check, length, vars, v, name, i;
                _check = this.binary.read('uint32');
                length = this.binary.read('uint32');
                if (_check !== NC_VARIABLE && _check !== ABSENT) {
                    throw new TypeError("Invalid variable array.");
                }
                vars = {};
                for (i = 0; i < length; i += 1) {
                    v = this.binary.read('VarType');
                    name = v.name;
                    delete v.name;
                    vars[name] = v;
                }
                return vars;
            },
            write: function (data) {
                var length = 0, v, key, name;
                for (key in data) {
                    if (data.hasOwnProperty(key)) {
                        length += 1;
                    }
                }
                if (length === 0) {
                    this.binary.write('uint32', ABSENT);
                    this.binary.write('uint32', 0);
                } else {
                    this.binary.write('uint32', NC_VARIABLE);
                    this.binary.write('uint32', data.length);
                    for (name in data) {
                        if (data.hasOwnProperty(name)) {
                            v = data[name];
                            v.name = name;
                            this.binary.write('VarType', v);
                            delete v.name;
                        }
                    }
                }
            }
        }),

        // Elements in the file

        magic: ['const', ['string', 3], 'CDF'],

        version: ['enum', 'char', {
            '\x01': 'classic',
            '\x02': '64bitOffset'
        }],

        numrecs: 'uint32',

        Header: {
            _magic: 'magic',
            version: 'version',
            numrecs: 'numrecs',
            dimensions: 'DimArray',
            attributes: 'AttrArray',
            variables: 'VarArray'
        }
    };
});
